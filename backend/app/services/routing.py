"""Crowd-aware walking routes over the curated walkway graph.

The graph is small (hundreds of nodes per site) so Dijkstra in-process is fine. The graph is
loaded from the database per request and cached for a few seconds. City-scale routing (home to
parking) is out of scope here: the app deep-links to the phone's maps app for that leg.
"""
from __future__ import annotations

import heapq
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Location, WalkwayEdge, WalkwayNode
from .crowd import CROWD_MULTIPLIER, effective_level
from .geo import bearing_to_words, haversine_m


@dataclass
class RouteResult:
    polyline: list[list[float]]
    distance_m: float
    eta_min: float
    steps: list[dict]
    crowd_notes: list[str]
    avoided_zones: list[str]


_cache: dict[int, tuple[float, dict]] = {}
_CACHE_TTL = 5.0


def _load_graph(db: Session, site_id: int) -> dict:
    now = time.time()
    hit = _cache.get(site_id)
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]
    nodes = {n.id: n for n in db.scalars(select(WalkwayNode).where(WalkwayNode.site_id == site_id))}
    edges = db.scalars(select(WalkwayEdge).where(WalkwayEdge.from_node.in_(nodes.keys()))).all()
    zone_ids = {e.zone_location_id for e in edges if e.zone_location_id}
    zones = {z.id: z for z in db.scalars(select(Location).where(Location.id.in_(zone_ids)))} if zone_ids else {}
    adj: dict[int, list[WalkwayEdge]] = {nid: [] for nid in nodes}
    for e in edges:
        adj[e.from_node].append(e)
        # edges are undirected walkways
        adj.setdefault(e.to_node, []).append(
            WalkwayEdge(
                id=-e.id,
                from_node=e.to_node,
                to_node=e.from_node,
                length_m=e.length_m,
                is_accessible=e.is_accessible,
                is_closed=e.is_closed,
                zone_location_id=e.zone_location_id,
            )
        )
    g = {"nodes": nodes, "adj": adj, "zones": zones}
    _cache[site_id] = (now, g)
    return g


def nearest_node(graph: dict, lat: float, lng: float) -> WalkwayNode | None:
    best, best_d = None, float("inf")
    for n in graph["nodes"].values():
        d = haversine_m(lat, lng, n.lat, n.lng)
        if d < best_d:
            best, best_d = n, d
    return best


def node_for_location(graph: dict, location_id: int) -> WalkwayNode | None:
    for n in graph["nodes"].values():
        if n.location_id == location_id:
            return n
    return None


def route(
    db: Session,
    site_id: int,
    from_lat: float,
    from_lng: float,
    to_location: Location,
    *,
    accessible: bool = False,
    avoid_crowd: bool = True,
) -> RouteResult | None:
    graph = _load_graph(db, site_id)
    if not graph["nodes"]:
        return None
    start = nearest_node(graph, from_lat, from_lng)
    goal = node_for_location(graph, to_location.id) or nearest_node(graph, to_location.lat, to_location.lng)
    if not start or not goal:
        return None

    zone_levels = {zid: effective_level(z)[0] for zid, z in graph["zones"].items()}
    avoided: set[str] = set()

    def edge_cost(e: WalkwayEdge) -> float | None:
        if e.is_closed:
            return None
        if accessible and not e.is_accessible:
            return None
        mult = 1.0
        if avoid_crowd and e.zone_location_id in zone_levels:
            lvl = zone_levels[e.zone_location_id]
            m = CROWD_MULTIPLIER.get(lvl, 1.0)
            if m is None:
                avoided.add(graph["zones"][e.zone_location_id].name)
                return None
            mult = m
        return e.length_m * mult

    dist = {start.id: 0.0}
    prev: dict[int, tuple[int, WalkwayEdge]] = {}
    pq = [(0.0, start.id)]
    while pq:
        d, nid = heapq.heappop(pq)
        if nid == goal.id:
            break
        if d > dist.get(nid, float("inf")):
            continue
        for e in graph["adj"].get(nid, []):
            c = edge_cost(e)
            if c is None:
                continue
            nd = d + c
            if nd < dist.get(e.to_node, float("inf")):
                dist[e.to_node] = nd
                prev[e.to_node] = (nid, e)
                heapq.heappush(pq, (nd, e.to_node))
    if goal.id not in dist:
        return None

    # reconstruct
    path_nodes: list[WalkwayNode] = []
    path_edges: list[WalkwayEdge] = []
    cur = goal.id
    while cur != start.id:
        p, e = prev[cur]
        path_nodes.append(graph["nodes"][cur])
        path_edges.append(e)
        cur = p
    path_nodes.append(start)
    path_nodes.reverse()
    path_edges.reverse()

    polyline = [[from_lat, from_lng]] + [[n.lat, n.lng] for n in path_nodes] + [[to_location.lat, to_location.lng]]
    total = haversine_m(from_lat, from_lng, start.lat, start.lng) + sum(e.length_m for e in path_edges)
    total += haversine_m(goal.lat, goal.lng, to_location.lat, to_location.lng)
    speed = settings.accessible_walk_speed_kmh if accessible else settings.walk_speed_kmh
    eta = total / 1000 / speed * 60

    steps: list[dict] = []
    for i, e in enumerate(path_edges):
        a, b = path_nodes[i], path_nodes[i + 1]
        label = b.label or (graph["zones"].get(e.zone_location_id).name if e.zone_location_id in graph["zones"] else "")
        steps.append(
            {
                "instruction": f"Walk {bearing_to_words(a.lat, a.lng, b.lat, b.lng)} {round(e.length_m)} m"
                + (f" towards {label}" if label else ""),
                "distance_m": round(e.length_m),
                "zone_level": zone_levels.get(e.zone_location_id, "unknown") if e.zone_location_id else None,
            }
        )
    steps.append({"instruction": f"Arrive at {to_location.name}", "distance_m": 0, "zone_level": None})

    notes = []
    for e in path_edges:
        if e.zone_location_id in zone_levels and zone_levels[e.zone_location_id] in ("high", "critical"):
            notes.append(f"{graph['zones'][e.zone_location_id].name} is {zone_levels[e.zone_location_id]} right now")
    return RouteResult(
        polyline=polyline,
        distance_m=round(total),
        eta_min=round(eta, 1),
        steps=steps,
        crowd_notes=sorted(set(notes)),
        avoided_zones=sorted(avoided),
    )


def invalidate() -> None:
    _cache.clear()

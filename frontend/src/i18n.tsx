/* Lightweight trilingual support. Pages may define extra local strings with `tr({te,hi,en})`. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Lang } from './api'

export type Tri = { te: string; hi: string; en: string }

const dict = {
  appName: { te: 'పుష్కర సహాయం', hi: 'पुष्कर सहायम', en: 'Pushkar Sahayam' },
  tagline: { te: 'గోదావరి పుష్కరాలు 2027', hi: 'गोदावरी पुष्करालु 2027', en: 'Godavari Pushkaralu 2027' },
  home: { te: 'హోమ్', hi: 'होम', en: 'Home' },
  map: { te: 'మ్యాప్', hi: 'नक्शा', en: 'Map' },
  crowd: { te: 'రద్దీ', hi: 'भीड़', en: 'Crowd' },
  parking: { te: 'పార్కింగ్', hi: 'पार्किंग', en: 'Parking' },
  family: { te: 'కుటుంబం', hi: 'परिवार', en: 'Family' },
  facilities: { te: 'సౌకర్యాలు', hi: 'सुविधाएँ', en: 'Facilities' },
  missing: { te: 'తప్పిపోయిన వారు', hi: 'गुमशुदा', en: 'Missing person' },
  emergency: { te: 'అత్యవసరం', hi: 'आपातकाल', en: 'Emergency' },
  more: { te: 'మరిన్ని', hi: 'और', en: 'More' },
  sos: { te: 'SOS', hi: 'SOS', en: 'SOS' },
  login: { te: 'లాగిన్', hi: 'लॉगिन', en: 'Login' },
  logout: { te: 'లాగ్ అవుట్', hi: 'लॉग आउट', en: 'Log out' },
  profile: { te: 'ప్రొఫైల్', hi: 'प्रोफ़ाइल', en: 'Profile' },
  language: { te: 'భాష', hi: 'भाषा', en: 'Language' },
  loading: { te: 'లోడ్ అవుతోంది…', hi: 'लोड हो रहा है…', en: 'Loading…' },
  retry: { te: 'మళ్ళీ ప్రయత్నించండి', hi: 'पुनः प्रयास करें', en: 'Retry' },
  offline: { te: 'ఆఫ్‌లైన్ - చివరిగా తెలిసిన సమాచారం చూపుతున్నాం', hi: 'ऑफ़लाइन - अंतिम ज्ञात जानकारी दिखा रहे हैं', en: 'Offline - showing last known information' },
  updated: { te: 'నవీకరణ', hi: 'अपडेट', en: 'Updated' },
  stale: { te: 'పాత సమాచారం', hi: 'पुरानी जानकारी', en: 'Stale data' },
  live: { te: 'లైవ్', hi: 'लाइव', en: 'Live' },
  low: { te: 'తక్కువ రద్దీ', hi: 'कम भीड़', en: 'Light crowd' },
  moderate: { te: 'మధ్యస్థ రద్దీ', hi: 'मध्यम भीड़', en: 'Moderate crowd' },
  high: { te: 'ఎక్కువ రద్దీ', hi: 'भारी भीड़', en: 'Heavy crowd' },
  critical: { te: 'అత్యధిక రద్దీ – వెళ్లవద్దు', hi: 'अत्यधिक भीड़ – न जाएँ', en: 'Very heavy – avoid' },
  unknown: { te: 'తాజా సమాచారం లేదు', hi: 'ताज़ा जानकारी नहीं', en: 'No recent data' },
  ghat: { te: 'ఘాట్', hi: 'घाट', en: 'Ghat' },
  gate: { te: 'గేట్', hi: 'गेट', en: 'Gate' },
  checkpoint: { te: 'చెక్‌పాయింట్', hi: 'चेकपॉइंट', en: 'Checkpoint' },
  help_desk: { te: 'సహాయ కేంద్రం', hi: 'सहायता केंद्र', en: 'Help desk' },
  medical: { te: 'వైద్య సహాయం', hi: 'चिकित्सा', en: 'Medical' },
  restroom: { te: 'మరుగుదొడ్లు', hi: 'शौचालय', en: 'Toilets' },
  water: { te: 'తాగునీరు', hi: 'पेयजल', en: 'Drinking water' },
  dressing_room: { te: 'దుస్తులు మార్చే గది', hi: 'वस्त्र बदलने का कक्ष', en: 'Changing room' },
  food: { te: 'ఆహారం', hi: 'भोजन', en: 'Food' },
  rest_area: { te: 'విశ్రాంతి', hi: 'विश्राम', en: 'Rest area' },
  police: { te: 'పోలీస్', hi: 'पुलिस', en: 'Police' },
  lost_found: { te: 'తప్పిపోయిన వారి కేంద్రం', hi: 'खोया-पाया', en: 'Lost & found' },
  bus_stop: { te: 'షటిల్ బస్', hi: 'शटल बस', en: 'Shuttle stop' },
  shuttle: { te: 'షటిల్', hi: 'शटल', en: 'Shuttle' },
  other: { te: 'ఇతర', hi: 'अन्य', en: 'Other' },
  accessible: { te: 'సులభ ప్రవేశం', hi: 'सुगम', en: 'Accessible' },
  directions: { te: 'దారి చూపండి', hi: 'रास्ता दिखाएँ', en: 'Directions' },
  nearMe: { te: 'నా దగ్గర', hi: 'मेरे पास', en: 'Near me' },
  recommended: { te: 'సిఫార్సు', hi: 'सुझाव', en: 'Recommended' },
  lessCrowded: { te: 'తక్కువ రద్దీ ఉన్న ఘాట్లు', hi: 'कम भीड़ वाले घाट', en: 'Less crowded ghats' },
  gates: { te: 'గేట్లు', hi: 'गेट', en: 'Gates' },
  ghats: { te: 'ఘాట్లు', hi: 'घाट', en: 'Ghats' },
  alerts: { te: 'హెచ్చరికలు', hi: 'अलर्ट', en: 'Alerts' },
  noAlerts: { te: 'ప్రస్తుతం హెచ్చరికలు లేవు', hi: 'अभी कोई अलर्ट नहीं', en: 'No active alerts' },
  free: { te: 'ఖాళీ', hi: 'खाली', en: 'free' },
  full: { te: 'నిండింది', hi: 'भर गया', en: 'Full' },
  filling: { te: 'నిండుతోంది', hi: 'भर रहा है', en: 'Filling up' },
  open: { te: 'తెరిచి ఉంది', hi: 'खुला', en: 'Open' },
  closed: { te: 'మూసివేయబడింది', hi: 'बंद', en: 'Closed' },
  rememberSpot: { te: 'నా వాహనం ఎక్కడ ఉందో గుర్తుంచు', hi: 'मेरी गाड़ी की जगह याद रखें', en: 'Remember where I parked' },
  mySpot: { te: 'నా వాహనం', hi: 'मेरी गाड़ी', en: 'My vehicle' },
  getPass: { te: 'డిజిటల్ పార్కింగ్ పాస్', hi: 'डिजिटल पार्किंग पास', en: 'Digital parking pass' },
  vehicleNumber: { te: 'వాహన నంబర్', hi: 'वाहन संख्या', en: 'Vehicle number' },
  walkToGate: { te: 'గేట్‌కు నడక', hi: 'गेट तक पैदल', en: 'Walk to gate' },
  save: { te: 'సేవ్', hi: 'सहेजें', en: 'Save' },
  cancel: { te: 'రద్దు', hi: 'रद्द', en: 'Cancel' },
  submit: { te: 'సమర్పించు', hi: 'जमा करें', en: 'Submit' },
  close: { te: 'మూసివేయి', hi: 'बंद करें', en: 'Close' },
  phone: { te: 'ఫోన్ నంబర్', hi: 'फ़ोन नंबर', en: 'Phone number' },
  name: { te: 'పేరు', hi: 'नाम', en: 'Name' },
  sendOtp: { te: 'OTP పంపండి', hi: 'OTP भेजें', en: 'Send OTP' },
  enterOtp: { te: 'OTP నమోదు చేయండి', hi: 'OTP दर्ज करें', en: 'Enter OTP' },
  verify: { te: 'ధృవీకరించు', hi: 'सत्यापित करें', en: 'Verify' },
  loginNeeded: { te: 'ఈ సేవ కోసం ఫోన్ నంబర్‌తో లాగిన్ అవ్వండి', hi: 'इस सेवा के लिए फ़ोन नंबर से लॉगिन करें', en: 'Log in with your phone number to use this service' },
  myFamily: { te: 'నా కుటుంబం', hi: 'मेरा परिवार', en: 'My family' },
  createFamily: { te: 'కుటుంబ గ్రూప్ సృష్టించు', hi: 'परिवार समूह बनाएँ', en: 'Create family group' },
  joinFamily: { te: 'కోడ్‌తో చేరండి', hi: 'कोड से जुड़ें', en: 'Join with code' },
  joinCode: { te: 'చేరే కోడ్', hi: 'जुड़ने का कोड', en: 'Join code' },
  addMember: { te: 'సభ్యుడిని జోడించు', hi: 'सदस्य जोड़ें', en: 'Add member' },
  linkTag: { te: 'రిస్ట్‌బ్యాండ్ లింక్ చేయి', hi: 'रिस्टबैंड जोड़ें', en: 'Link wristband' },
  unlinkTag: { te: 'రిస్ట్‌బ్యాండ్ తొలగించు', hi: 'रिस्टबैंड हटाएँ', en: 'Unlink wristband' },
  tagUid: { te: 'రిస్ట్‌బ్యాండ్ నంబర్', hi: 'रिस्टबैंड नंबर', en: 'Wristband number' },
  consentText: { te: 'ఈ వ్యక్తి (లేదా వారి సంరక్షకుడిగా నేను) చెక్‌పాయింట్‌ల వద్ద ఈ రిస్ట్‌బ్యాండ్ గుర్తించబడటానికి, ఆ సమాచారం మా కుటుంబానికి మరియు తప్పిపోయిన సందర్భంలో అధికారులకు చూపబడటానికి అంగీకరిస్తున్నాను. పుష్కరాలు ముగిసిన 30 రోజుల తర్వాత ఈ డేటా తొలగించబడుతుంది.', hi: 'मैं (या इस व्यक्ति के अभिभावक के रूप में) सहमत हूँ कि यह रिस्टबैंड चेकपॉइंट पर पढ़ा जाए और यह जानकारी हमारे परिवार को, तथा गुमशुदगी की स्थिति में अधिकारियों को दिखाई जाए। पुष्करालु के 30 दिन बाद यह डेटा हटा दिया जाएगा।', en: 'I (or as this person\'s guardian) consent to this wristband being detected at checkpoints and that information being shown to our family, and to officials if a missing-person report is filed. Data is deleted 30 days after the festival.' },
  lastSeen: { te: 'చివరిగా కనిపించింది', hi: 'अंतिम बार देखा गया', en: 'Last seen' },
  neverSeen: { te: 'ఇంకా ఏ చెక్‌పాయింట్ వద్ద కనిపించలేదు', hi: 'अभी तक किसी चेकपॉइंट पर नहीं देखा गया', en: 'Not yet detected at any checkpoint' },
  shareGps: { te: 'నా స్థానాన్ని కుటుంబంతో పంచుకో', hi: 'मेरी लोकेशन परिवार से साझा करें', en: 'Share my location with family' },
  reportMissing: { te: 'తప్పిపోయినట్లు నివేదించు', hi: 'गुमशुदगी की रिपोर्ट करें', en: 'Report missing' },
  myReports: { te: 'నా నివేదికలు', hi: 'मेरी रिपोर्ट', en: 'My reports' },
  foundBoard: { te: 'సహాయ కేంద్రాల్లో ఉన్నవారు', hi: 'सहायता केंद्रों पर मिले लोग', en: 'People at help desks' },
  age: { te: 'వయసు', hi: 'उम्र', en: 'Age' },
  gender: { te: 'లింగం', hi: 'लिंग', en: 'Gender' },
  clothing: { te: 'దుస్తులు', hi: 'कपड़े', en: 'Clothing' },
  description: { te: 'వివరణ', hi: 'विवरण', en: 'Description' },
  lastSeenPlace: { te: 'చివరిగా చూసిన ప్రదేశం', hi: 'अंतिम स्थान', en: 'Last seen place' },
  photo: { te: 'ఫోటో (ఐచ్ఛికం)', hi: 'फ़ोटो (वैकल्पिक)', en: 'Photo (optional)' },
  photoConsent: { te: 'ఈ ఫోటోను అధికారులు గుర్తింపు కోసం మాత్రమే ఉపయోగించడానికి అంగీకరిస్తున్నాను', hi: 'मैं सहमत हूँ कि यह फ़ोटो केवल अधिकारियों द्वारा पहचान के लिए उपयोग हो', en: 'I agree that this photo is used by officials only, for identification' },
  status: { te: 'స్థితి', hi: 'स्थिति', en: 'Status' },
  call: { te: 'కాల్ చేయండి', hi: 'कॉल करें', en: 'Call' },
  nearestHelp: { te: 'సమీప సహాయం', hi: 'निकटतम सहायता', en: 'Nearest help' },
  sendSos: { te: 'సహాయం పంపండి', hi: 'मदद भेजें', en: 'Send for help' },
  sosSent: { te: 'మీ అభ్యర్థన కంట్రోల్ రూమ్‌కు చేరింది. సిబ్బంది త్వరలో సంప్రదిస్తారు.', hi: 'आपका अनुरोध कंट्रोल रूम तक पहुँच गया। कर्मचारी शीघ्र संपर्क करेंगे।', en: 'Your request reached the control room. Staff will contact you shortly.' },
  confirm: { te: 'నిర్ధారించు', hi: 'पुष्टि करें', en: 'Confirm' },
  distance: { te: 'దూరం', hi: 'दूरी', en: 'Distance' },
  eta: { te: 'నడక సమయం', hi: 'पैदल समय', en: 'Walking time' },
  avoidCrowd: { te: 'రద్దీని తప్పించు', hi: 'भीड़ से बचें', en: 'Avoid crowds' },
  demoNote: { te: 'డెమో డేటా: ఘాట్‌ల స్థానాలు, సామర్థ్యాలు సర్వే చేయబడలేదు', hi: 'डेमो डेटा: घाट स्थान व क्षमता सर्वेक्षित नहीं', en: 'Demo data: ghat positions and capacities are not surveyed' },
  source: { te: 'మూలం', hi: 'स्रोत', en: 'Source' },
  camera: { te: 'కెమెరా AI', hi: 'कैमरा AI', en: 'Camera AI' },
  rfid: { te: 'RFID కౌంటర్', hi: 'RFID काउंटर', en: 'RFID counter' },
  manual: { te: 'సిబ్బంది నవీకరణ', hi: 'कर्मचारी अपडेट', en: 'Staff update' },
  estimate: { te: 'అంచనా', hi: 'अनुमान', en: 'Estimate' },
  video: { te: 'రికార్డ్ వీడియో పరీక్ష', hi: 'रिकॉर्डेड वीडियो जाँच', en: 'Recorded-video check' },
  people: { te: 'మంది', hi: 'लोग', en: 'people' },
  capacity: { te: 'సామర్థ్యం', hi: 'क्षमता', en: 'capacity' },
  error: { te: 'లోపం', hi: 'त्रुटि', en: 'Error' },
  seniors: { te: 'వృద్ధులు / దివ్యాంగులు', hi: 'वरिष्ठ / दिव्यांग', en: 'Seniors / disabled' },
  staffMode: { te: 'సిబ్బంది మోడ్', hi: 'कर्मचारी मोड', en: 'Staff mode' },
  admin: { te: 'అడ్మిన్', hi: 'एडमिन', en: 'Admin' },

  // ---- navigation & shell (v2)
  explore: { te: 'మ్యాప్', hi: 'नक्शा', en: 'Explore' },
  brandShort: { te: 'పుష్కరాలు 2027', hi: 'पुष्करालु 2027', en: 'Pushkaralu 2027' },
  services: { te: 'సేవలు', hi: 'सेवाएँ', en: 'Services' },
  notifications: { te: 'సూచనలు', hi: 'सूचनाएँ', en: 'Notifications' },
  emergencyAssist: { te: 'అత్యవసర సహాయం', hi: 'आपातकालीन सहायता', en: 'Emergency help' },
  back: { te: 'వెనుకకు', hi: 'वापस', en: 'Back' },
  seeAll: { te: 'అన్నీ చూడండి', hi: 'सब देखें', en: 'See all' },
  openMap: { te: 'మ్యాప్ తెరవండి', hi: 'नक्शा खोलें', en: 'Open map' },
  mapView: { te: 'మ్యాప్', hi: 'नक्शा', en: 'Map' },
  listView: { te: 'జాబితా', hi: 'सूची', en: 'List' },
  search: { te: 'వెతకండి', hi: 'खोजें', en: 'Search' },
  done: { te: 'పూర్తయింది', hi: 'हो गया', en: 'Done' },
  next: { te: 'తదుపరి', hi: 'आगे', en: 'Next' },
  skip: { te: 'దాటవేయి', hi: 'छोड़ें', en: 'Skip' },
  notNow: { te: 'ఇప్పుడు కాదు', hi: 'अभी नहीं', en: 'Not now' },
  continue: { te: 'కొనసాగించు', hi: 'जारी रखें', en: 'Continue' },
  // quick actions
  findGhat: { te: 'ఘాట్ కనుగొనండి', hi: 'घाट खोजें', en: 'Find a ghat' },
  crowdStatus: { te: 'రద్దీ స్థితి', hi: 'भीड़ की स्थिति', en: 'Crowd status' },
  findParking: { te: 'పార్కింగ్', hi: 'पार्किंग खोजें', en: 'Find parking' },
  familyTracker: { te: 'కుటుంబ ట్రాకర్', hi: 'परिवार ट्रैकर', en: 'Family tracker' },
  findMissing: { te: 'తప్పిపోయినవారు', hi: 'गुमशुदा खोजें', en: 'Missing person' },
  facilitiesNearMe: { te: 'సమీప సౌకర్యాలు', hi: 'पास की सुविधाएँ', en: 'Facilities near me' },
  medicalHelp: { te: 'వైద్య సహాయం', hi: 'चिकित्सा सहायता', en: 'Medical help' },
  // freshness
  fLive: { te: 'లైవ్', hi: 'लाइव', en: 'Live' },
  fStaff: { te: 'సిబ్బంది నవీకరణ', hi: 'कर्मचारी अपडेट', en: 'Staff update' },
  fDelayed: { te: 'ఆలస్యం', hi: 'विलंबित', en: 'Delayed' },
  fStale: { te: 'తాజా కాదు', hi: 'ताज़ा नहीं', en: 'Not recent' },
  fNone: { te: 'ఇంకా సమాచారం లేదు', hi: 'अभी कोई जानकारी नहीं', en: 'No data yet' },
  fEstimate: { te: 'అంచనా', hi: 'अनुमान', en: 'Estimate' },
  justNow: { te: 'ఇప్పుడే', hi: 'अभी', en: 'just now' },
  offlineSince: { te: 'ఆఫ్‌లైన్ · చివరి సమాచారం', hi: 'ऑफ़लाइन · अंतिम जानकारी', en: 'Offline · showing data from' },
  livePaused: { te: 'లైవ్ నవీకరణలు ఆగాయి · చివరి నవీకరణ', hi: 'लाइव अपडेट रुके · अंतिम अपडेट', en: 'Live updates paused · last updated' },
  savedCopy: { te: 'సేవ్ చేసిన సమాచారం', hi: 'सहेजी गई जानकारी', en: 'Saved copy' },
  noConnection: { te: 'ఇంటర్నెట్ లేదు', hi: 'इंटरनेट नहीं', en: 'No internet connection' },
  // location
  myLocation: { te: 'నా స్థానం', hi: 'मेरा स्थान', en: 'My location' },
  useMyLocation: { te: 'నా స్థానం ఉపయోగించు', hi: 'मेरा स्थान उपयोग करें', en: 'Use my location' },
  chooseManually: { te: 'నేనే ఎంచుకుంటాను', hi: 'मैं स्वयं चुनूँगा', en: 'Choose manually' },
  iAmNear: { te: 'నేను ఈ ప్రదేశం దగ్గర ఉన్నాను', hi: 'मैं यहाँ के पास हूँ', en: 'I am near…' },
  locationOff: { te: 'స్థానం ఆఫ్‌లో ఉంది', hi: 'स्थान बंद है', en: 'Location is off' },
  locationDenied: { te: 'స్థాన అనుమతి నిరాకరించబడింది. బ్రౌజర్ సెట్టింగ్‌లలో మార్చవచ్చు లేదా స్థలాన్ని ఎంచుకోండి.', hi: 'स्थान अनुमति अस्वीकृत। ब्राउज़र सेटिंग में बदलें या स्थान चुनें।', en: 'Location permission was denied. Change it in browser settings, or choose a place.' },
  locationWhy: { te: 'సమీప ఘాట్‌లు, గేట్‌లు, సహాయ కేంద్రాలు మరియు నడక దూరం చూపడానికి మాత్రమే. మీ స్థానం నిల్వ చేయబడదు.', hi: 'केवल पास के घाट, गेट, सहायता केंद्र और पैदल दूरी दिखाने के लिए। आपका स्थान सहेजा नहीं जाता।', en: 'Only used to show nearby ghats, gates, help desks and walking distance. Your location is not stored.' },
  gpsFix: { te: 'GPS', hi: 'GPS', en: 'GPS' },
  chosenPlace: { te: 'ఎంచుకున్న ప్రదేశం', hi: 'चुना गया स्थान', en: 'Chosen place' },
  nearestGate: { te: 'సమీప గేట్', hi: 'निकटतम गेट', en: 'Nearest gate' },
  farFromSite: { te: 'మీరు పుష్కర ప్రాంతానికి దూరంగా ఉన్నారు', hi: 'आप पुष्कर क्षेत्र से दूर हैं', en: 'You are away from the Pushkaralu area' },
  change: { te: 'మార్చు', hi: 'बदलें', en: 'Change' },
  // status words for the brief: safe / moderate / heavy
  walk: { te: 'నడక', hi: 'पैदल', en: 'walk' },
  minShort: { te: 'నిమి.', hi: 'मिनट', en: 'min' },
  away: { te: 'దూరం', hi: 'दूर', en: 'away' },
  privacy: { te: 'గోప్యత', hi: 'गोपनीयता', en: 'Privacy' },
  permissions: { te: 'అనుమతులు', hi: 'अनुमतियाँ', en: 'Permissions' },
  display: { te: 'ప్రదర్శన', hi: 'प्रदर्शन', en: 'Display' },
  largeText: { te: 'పెద్ద అక్షరాలు', hi: 'बड़े अक्षर', en: 'Large text' },
  highContrast: { te: 'ఎండలో స్పష్టంగా (అధిక కాంట్రాస్ట్)', hi: 'धूप में स्पष्ट (उच्च कंट्रास्ट)', en: 'Sunlight mode (high contrast)' },
  vibration: { te: 'వైబ్రేషన్ ఫీడ్‌బ్యాక్', hi: 'कंपन प्रतिक्रिया', en: 'Vibration feedback' },
  darkTheme: { te: 'డార్క్ థీమ్', hi: 'डार्क थीम', en: 'Dark theme' },
  account: { te: 'ఖాతా', hi: 'खाता', en: 'Account' },
  copied: { te: 'కాపీ అయింది', hi: 'कॉपी हो गया', en: 'Copied' },
  saved: { te: 'సేవ్ అయింది', hi: 'सहेजा गया', en: 'Saved' },
  tryAgain: { te: 'మళ్ళీ ప్రయత్నించండి', hi: 'फिर से कोशिश करें', en: 'Try again' },
  somethingWrong: { te: 'ఏదో తప్పు జరిగింది', hi: 'कुछ गलत हो गया', en: 'Something went wrong' },
  required: { te: 'తప్పనిసరి', hi: 'आवश्यक', en: 'Required' },
  optional: { te: 'ఐచ్ఛికం', hi: 'वैकल्पिक', en: 'optional' },
  officialOnly: { te: 'అధికారిక సమాచారం మాత్రమే', hi: 'केवल आधिकारिक जानकारी', en: 'Official information only' },
  // ghats & verification
  ghatsDirectory: { te: 'ఘాట్‌లు', hi: 'घाट', en: 'Ghats' },
  bathingCentres: { te: 'స్నాన కేంద్రాలు', hi: 'स्नान केंद्र', en: 'Bathing centres' },
  railway_station: { te: 'రైల్వే స్టేషన్', hi: 'रेलवे स्टेशन', en: 'Railway station' },
  vOfficial: { te: 'అధికారికంగా ధృవీకరించబడింది', hi: 'आधिकारिक रूप से सत्यापित', en: 'Verified by organisers' },
  vSource: { te: 'మ్యాప్ మూలం (OpenStreetMap)', hi: 'मानचित्र स्रोत (OpenStreetMap)', en: 'Map source (OpenStreetMap)' },
  vUnverified: { te: 'స్థానం ధృవీకరించబడలేదు', hi: 'स्थान सत्यापित नहीं', en: 'Location not verified' },
  vUnavailable: { te: 'అందుబాటులో లేదు', hi: 'उपलब्ध नहीं', en: 'Unavailable' },
  vDemo: { te: 'డెమో డేటా', hi: 'डेमो डेटा', en: 'Demo data' },
  notPublished: { te: 'నిర్వాహకులు ఇంకా ప్రచురించలేదు', hi: 'आयोजकों ने अभी प्रकाशित नहीं किया', en: 'Not yet published by the organisers' },
  noneNearby: { te: 'సమీపంలో మ్యాప్ చేయబడలేదు', hi: 'पास में मैप नहीं किया गया', en: 'None mapped nearby' },
  openInMaps: { te: 'మ్యాప్స్ యాప్‌లో తెరవండి', hi: 'मैप्स ऐप में खोलें', en: 'Open in Maps app' },
  viewDetails: { te: 'వివరాలు', hi: 'विवरण', en: 'Details' },
  dataSource: { te: 'సమాచార మూలం', hi: 'डेटा स्रोत', en: 'Data source' },
  noVerifiedCrowd: { te: 'ధృవీకరించిన రద్దీ సమాచారం లేదు', hi: 'सत्यापित भीड़ जानकारी नहीं', en: 'No verified crowd data' },
} satisfies Record<string, Tri>

export type Key = keyof typeof dict

interface Ctx {
  lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string; tr: (o: Partial<Tri> & { en: string }) => string
  name: (o: { name: string; name_te?: string | null; name_hi?: string | null }) => string
  /** localized relative time: "5 నిమి. క్రితం" */
  ago: (iso?: string | number | null) => string
  /** localized clock time: "10:42" */
  clock: (iso?: string | number | null) => string
  /** "6 min walk" in the current language */
  walkText: (minutes: number) => string
  /** localized number */
  num: (n: number) => string
}
const LOCALE: Record<Lang, string> = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' }
function agoIn(lang: Lang, iso?: string | number | null): string {
  if (iso == null || iso === '') return '—'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  const m = Math.floor(s / 60), h = Math.floor(s / 3600), d = Math.floor(s / 86400)
  if (s < 60) return dict.justNow[lang]
  if (lang === 'te') return m < 60 ? `${m} నిమి. క్రితం` : h < 24 ? `${h} గం. క్రితం` : `${d} రోజుల క్రితం`
  if (lang === 'hi') return m < 60 ? `${m} मिनट पहले` : h < 24 ? `${h} घंटे पहले` : `${d} दिन पहले`
  return m < 60 ? `${m} min ago` : h < 24 ? `${h} h ago` : `${d} d ago`
}
const LangCtx = createContext<Ctx | null>(null)
const LANG_KEY = 'ps.lang'

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { return (localStorage.getItem(LANG_KEY) as Lang) || 'te' } catch { return 'te' }
  })
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem(LANG_KEY, l) } catch { /* ignore */ } document.documentElement.lang = l }, [])
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang,
    t: (k) => dict[k][lang],
    tr: (o) => o[lang] ?? o.en,
    name: (o) => (lang === 'te' && o.name_te) || (lang === 'hi' && o.name_hi) || o.name,
    ago: (iso) => agoIn(lang, iso),
    clock: (iso) => (iso == null || iso === '' ? '—' : new Date(iso).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' })),
    walkText: (mins) => (lang === 'te' ? `${mins} నిమి. నడక` : lang === 'hi' ? `${mins} मिनट पैदल` : `${mins} min walk`),
    num: (n) => n.toLocaleString(LOCALE[lang]),
  }), [lang, setLang])
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>
}

export function useLang(): Ctx {
  const c = useContext(LangCtx)
  if (!c) throw new Error('LangProvider missing')
  return c
}

export const LANG_LABELS: Record<Lang, string> = { te: 'తెలుగు', hi: 'हिन्दी', en: 'English' }

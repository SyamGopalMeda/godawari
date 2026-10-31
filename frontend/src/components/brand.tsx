/* GloomDev brand pieces: credit block with the official logo, and a text wordmark for tight spaces. */
import { useLang } from '../i18n'

export function GloomDevWordmark() {
  return <span className="gd-word" aria-label="GloomDev">Gloom<span className="dev">Dev</span></span>
}

export function GloomDevCredit() {
  const { tr } = useLang()
  return (
    <div className="gd-credit">
      <span>{tr({ te: 'రూపకల్పన & అభివృద్ధి', hi: 'डिज़ाइन व विकास', en: 'Designed & developed by' })}</span>
      <img src="/brand/gloomdev-logo.webp" width={200} height={90} alt="GloomDev – Empowering Innovation Through Technology" decoding="async" />
    </div>
  )
}

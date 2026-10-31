/** Splash logosu: iki üçgenli markanın animasyonlu hâli.
 *
 * Alt üçgen önce üsttekiyle bitişik ("kaymasız") durur, deprem gibi titrer ve
 * ardından logodaki kayık konumuna kayar. Renkler tema değişkenlerinden gelir.
 */
export function SplashMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="12 0 100 120"
      role="img"
      aria-label="ClipStream"
      className={className}
    >
      <title>ClipStream</title>
      <polygon
        className="splash-mark-top"
        points="32,6 99.6,45.6 32,63.6"
        strokeWidth={6}
        strokeLinejoin="round"
      />
      <polygon
        className="splash-mark-twin"
        points="21,74.6 88.6,56.6 103,65 21,113"
        strokeWidth={6}
        strokeLinejoin="round"
      />
    </svg>
  )
}

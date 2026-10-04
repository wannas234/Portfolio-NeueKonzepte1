import Image from "next/image";
import s from "./BrandLogo.module.css";

/**
 * UniVerse brand mark, using the delivered local raster assets (public/brand):
 * the swash "U" icon alone when collapsed, the full "UniVerse" lockup otherwise.
 *
 * The delivered files have an opaque background baked in, which is invisible on
 * the light shell but shows as a box on a dark one. The `-ondark` files are
 * derived from the very same light originals — background keyed out, the navy
 * wordmark recoloured light — so they keep the identical canvas, mark size and
 * spacing. Both variants therefore render at exactly the same size and position
 * for a given CSS height.
 *
 * `dark` forces the delivered dark badge for surfaces that are dark in every
 * theme; otherwise both are rendered and CSS picks one from `data-theme`, so
 * the right one is correct on first paint and cannot mismatch on hydration.
 */
const ASSETS = {
  mark: { light: "/brand/logo-icon.png", onDark: "/brand/logo-icon-ondark-v2.png", dark: "/brand/logo-icon-dark.png", width: 132, height: 112, style: s.icon },
  lockup: { light: "/brand/logo-horizontal.png", onDark: "/brand/logo-horizontal-ondark-v2.png", dark: "/brand/logo-horizontal-dark.png", width: 346, height: 105, style: s.wordmark },
} as const;

export default function BrandLogo({
  mark = false,
  dark = false,
  className,
}: {
  mark?: boolean;
  dark?: boolean;
  className?: string;
}) {
  const a = mark ? ASSETS.mark : ASSETS.lockup;

  if (dark) {
    return (
      <Image src={a.dark} alt="UniVerse" width={a.width} height={a.height} priority
        className={`${a.style} ${className ?? ""}`} />
    );
  }

  return (
    <>
      <Image src={a.light} alt="UniVerse" width={a.width} height={a.height} priority
        className={`${a.style} ${s.onLight} ${className ?? ""}`} />
      <Image src={a.onDark} alt="" aria-hidden="true" width={a.width} height={a.height} priority
        className={`${a.style} ${s.onDark} ${className ?? ""}`} />
    </>
  );
}

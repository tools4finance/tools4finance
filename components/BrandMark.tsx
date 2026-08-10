import Image from "next/image";

// Icon + typed wordmark, in the site's own accent color — used inside a
// `<Link href="/" className="nav-brand">` on every topbar (homepage,
// aidat, customer-segmentation, kpi-tracker). The logo-wordmark.png asset
// reads too faint at header height, so the text is typed here instead.
export default function BrandMark() {
  return (
    <>
      <div className="nav-logo">
        <Image src="/logo-icon.png" alt="tools4finance" width={34} height={34} priority />
      </div>
      <span className="nav-wordmark">
        <span className="nw-tools">tools</span>
        <span className="nw-4finance">4finance</span>
      </span>
    </>
  );
}

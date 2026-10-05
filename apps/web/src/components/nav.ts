export interface NavItem {
  label: string;
  href: string;
  children?: Array<{ label: string; href: string }>;
}

export const NAV: NavItem[] = [
  { label: "HOME", href: "/" },
  { label: "PORTFOLIO", href: "/portfolio" },
  { label: "TAX", href: "/tax", children: [{ label: "Tax reserve", href: "/tax-reserve" }] },
  { label: "GIVE", href: "/give" },
  { label: "LAUNCH", href: "/launch", children: [{ label: "Configuration", href: "/launch/configuration" }] },
  { label: "DISCOVER", href: "/discover" },
  { label: "ANALYTICS", href: "/analytics" },
  { label: "VAULTS", href: "/vaults" },
  { label: "DOCUMENTS", href: "/documents" },
];

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

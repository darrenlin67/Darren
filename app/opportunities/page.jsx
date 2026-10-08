import Link from "next/link";
import OpportunitiesClient from "./OpportunitiesClient";

export const metadata = {
  title: "Opportunities — Darren",
  description: "Current opportunities checked against official sources.",
};

export default function OpportunitiesPage() {
  return <div className="site-shell">
    <header className="topbar">
      <Link className="wordmark" href="/" aria-label="Darren home"><span>D</span><span className="wordmark-dot">.</span></Link>
      <nav aria-label="Main navigation"><Link href="/#about">About</Link><Link href="/#interests">My interests</Link><Link href="/opportunities" aria-current="page">Opportunities</Link></nav>
      <Link className="top-link" href="/">Home <span aria-hidden="true">↗</span></Link>
    </header>
    <main className="opportunities-page" aria-labelledby="page-title"><OpportunitiesClient /></main>
    <footer><Link className="wordmark" href="/"><span>D</span><span className="wordmark-dot">.</span></Link><span>MADE FOR THE LOVE OF THE GAME</span><span>© DARREN</span></footer>
  </div>;
}

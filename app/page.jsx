import { readFileSync } from "node:fs";
import { join } from "node:path";
import HomeWelcome from "./HomeWelcome";

const source = readFileSync(join(process.cwd(), "content.html"), "utf8");

export default function Home() {
  return <>
    <HomeWelcome />
    <div dangerouslySetInnerHTML={{ __html: source }} />
  </>;
}

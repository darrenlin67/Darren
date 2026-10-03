import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "content.html"), "utf8");

export default function Home() {
  return <div dangerouslySetInnerHTML={{ __html: source }} />;
}

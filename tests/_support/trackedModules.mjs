// Split a directory listing into the modules that are actually part of the repository
// and the ones a session has not committed yet. "Bundled" has to mean committed: an
// uncommitted scratch module cannot be deployed, and letting it fail a repo-wide gate
// means one session's work-in-progress stops everyone else.
import {execFileSync} from "node:child_process";

export function trackedModuleNames(root, directory) {
  const listing = execFileSync("git", ["ls-files", "--", directory], {
    cwd: root, encoding: "utf8",
  });
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(directory + "/"))
    .map((line) => line.slice(directory.length + 1))
    .filter((line) => /^coop[A-Za-z0-9.]+\.cjs$/.test(line))
    .map((line) => line.slice(0, -4))
    .sort();
}

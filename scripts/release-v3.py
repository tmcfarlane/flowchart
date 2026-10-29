#!/usr/bin/env python3
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
from urllib.parse import quote


REPO = "tmcfarlane/flowchart"
TAG = "v3.0.0"
VERSION = "3.0.0"
MEDIA = f"public/releases/{TAG}"
NOTES = f"docs/releases/{TAG}.md"
RAW = f"https://raw.githubusercontent.com/{REPO}/{TAG}/{MEDIA}/"
IMAGES = {
    "draw-workspace-dark.png": (1440, 960),
    "draw-workspace-light.png": (1440, 960),
    "ai-draw-preview-dark.png": (1440, 960),
    "ai-selection-preview-dark.png": (1440, 960),
    "shape-text-dark.png": (1440, 960),
    "components-frames-light.png": (1440, 960),
    "mobile-draw-light.png": (390, 844),
    "architecture-light.png": (1440, 960),
    "excalidraw-import-dark.png": (1440, 960),
    "flowchart-light.png": (1440, 960),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args, data=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, check=True).stdout


def git(*args):
    return run("git", *args).decode().strip()


def committed(path):
    return run("git", "show", f"HEAD:{path}")


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            attrs = dict(attrs)
            self.images.append((attrs.get("alt", ""), attrs.get("src", "")))


def validate():
    expected = {
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_REF": f"refs/tags/{TAG}",
        "GITHUB_REF_TYPE": "tag",
        "GITHUB_REF_NAME": TAG,
        "GITHUB_EVENT_NAME": "push",
    }
    for name, value in expected.items():
        require(os.environ.get(name) == value, f"Expected {name}={value}")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    require(event.get("created") is True and event.get("deleted") is False,
            "Only a newly created, undeleted tag can publish")
    require(event.get("ref") == f"refs/tags/{TAG}", "Event tag differs")
    sha = os.environ.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "Expected a full commit SHA")
    require(git("rev-parse", "HEAD") == sha, "HEAD differs from event commit")
    require(git("rev-parse", f"{TAG}^{{commit}}") == sha, "Tag differs from event commit")
    run("git", "merge-base", "--is-ancestor", sha, "origin/main")
    package = json.loads(committed("package.json"))
    lock = json.loads(committed("package-lock.json"))
    require(package.get("version") == lock.get("version") ==
            lock.get("packages", {}).get("", {}).get("version") == VERSION,
            "Package and lock versions must all be 3.0.0")
    paths = git("ls-tree", "-r", "--name-only", "HEAD", "--", MEDIA).splitlines()
    pngs = {path for path in paths if path.lower().endswith(".png")}
    require(pngs == {f"{MEDIA}/{name}" for name in IMAGES}, "Screenshot set differs")
    manifest = committed(f"{MEDIA}/SHA256SUMS").decode()
    hashes = {}
    for line in manifest.splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([a-z0-9-]+\.png)", line)
        require(match is not None, "Invalid SHA256SUMS entry")
        digest, name = match.groups()
        require(name not in hashes, "Duplicate SHA256SUMS entry")
        hashes[name] = digest
    require(hashes.keys() == IMAGES.keys(), "SHA256SUMS screenshot set differs")
    for name, dimensions in IMAGES.items():
        image = committed(f"{MEDIA}/{name}")
        require(image[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" and len(image) >= 33,
                f"Invalid PNG signature or header for {name}")
        require(struct.unpack(">II", image[16:24]) == dimensions, f"Wrong dimensions for {name}")
        require(hashlib.sha256(image).hexdigest() == hashes[name], f"Checksum differs for {name}")
    notes = committed(NOTES).decode("utf-8")
    require(notes.strip(), "Release notes are empty")
    require(f"https://github.com/{REPO}/blob/{TAG}/LICENSE" in notes and "MIT" in notes,
            "Release notes must link the MIT license")
    require(f"https://github.com/{REPO}/tree/{TAG}" in notes, "Release notes must link tagged source")
    require(not re.search(r"(?:#|/issues/)(?:42|43|44|45)\b", notes),
            "Release notes include unimplemented issues")
    images = []
    paragraphs = re.split(r"\n\s*\n", notes)
    for index, paragraph in enumerate(paragraphs):
        html = Images()
        html.feed(paragraph)
        found = re.findall(r"!\[([^\]]*)\]\(([^\s)]+)\)", paragraph) + html.images
        if found:
            require(index + 1 < len(paragraphs), "Missing screenshot caption")
            caption = paragraphs[index + 1].strip()
            require(caption and not caption.startswith(("#", "!", "<", "-", "```")),
                    "Missing screenshot caption")
            images.extend(found)
    require(len(images) == len(IMAGES), "Release notes must include every screenshot once")
    require({url for _, url in images} == {RAW + name for name in IMAGES},
            "Release notes image URLs must use the exact tagged screenshot set")
    require(all(alt.strip() for alt, _ in images), "Screenshot alt text is empty")
    print(f"Validated {TAG} at {sha} with {len(IMAGES)} screenshots", flush=True)
    return sha, notes


def api(endpoint, payload=None, binary=False):
    args = ["gh", "api", "--hostname", "github.com", endpoint]
    if payload is not None:
        args.extend(["--method", "PATCH", "--input", "-"])
    if binary:
        args.extend(["--header", "Accept: application/octet-stream"])
    response = run(*args, data=None if payload is None else json.dumps(payload).encode())
    return response if binary else json.loads(response)


def releases():
    result = []
    page = 1
    while True:
        batch = api(f"repos/{REPO}/releases?per_page=100&page={page}")
        require(isinstance(batch, list) and all(isinstance(item, dict) for item in batch),
                "Invalid authenticated release listing")
        result.extend(item for item in batch if item.get("tag_name") == TAG)
        if len(batch) < 100:
            return result
        page += 1


def remote_tag(sha):
    target = api(f"repos/{REPO}/git/ref/tags/{TAG}")["object"]
    tag_object = target["sha"]
    for _ in range(10):
        if target.get("type") == "commit":
            require(target.get("sha") == sha, "Remote tag commit differs")
            return tag_object
        require(target.get("type") == "tag", "Remote tag does not resolve to a commit")
        target = api(f"repos/{REPO}/git/tags/{target['sha']}")["object"]
    raise ValueError("Remote tag nesting is too deep")


def verify_release(release, release_id, notes, assets, draft):
    require(type(release_id) is int and release_id > 0 and
            type(release.get("id")) is int and release["id"] == release_id,
            "Release ID differs")
    require(release.get("tag_name") == TAG and release.get("name") == TAG,
            "Release tag or title differs")
    require(release.get("body") == notes, "Release body differs from committed notes")
    require(release.get("draft") is draft and release.get("prerelease") is False,
            "Release draft or prerelease state differs")
    if not draft:
        require(release.get("published_at"), "Release has no publication date")
    remote_assets = release.get("assets", [])
    require(len(remote_assets) == len(assets), "Release asset count differs")
    require({asset.get("name") for asset in remote_assets} == assets.keys(),
            "Release asset names differ")
    for asset in remote_assets:
        require(type(asset.get("id")) is int and asset["id"] > 0,
                "Invalid release asset ID")
        require(asset.get("state") == "uploaded" and
                asset.get("size") == len(assets[asset["name"]]), "Release asset state or size differs")
    return {asset["name"]: asset["id"] for asset in remote_assets}


def publish(sha, notes):
    require(os.environ.get("GH_TOKEN"), "GH_TOKEN is required")
    require(not releases(), "An existing release or draft already uses v3.0.0; left untouched")
    tag_object = remote_tag(sha)
    with tempfile.TemporaryDirectory(prefix="flowchart-release-") as directory:
        directory = Path(directory)
        archive = directory / f"flowchart-{TAG}-screenshots.zip"
        run("git", "archive", "--format=zip", f"--output={archive}", sha, MEDIA)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        checksum = archive.with_suffix(".zip.sha256")
        checksum.write_text(f"{digest}  {archive.name}\n")
        notes_file = directory / "notes.md"
        notes_file.write_bytes(notes.encode())
        run("gh", "release", "create", TAG, "--repo", f"github.com/{REPO}", "--verify-tag", "--draft",
            "--title", TAG, "--notes-file", str(notes_file))
        matches = releases()
        require(len(matches) == 1, "Expected exactly one newly created release draft")
        release_id = matches[0].get("id")
        require(type(release_id) is int and release_id > 0, "Invalid draft release ID")
        endpoint = f"repos/{REPO}/releases/{release_id}"
        print(f"Created draft release {release_id}; failures leave it unpublished", flush=True)
        verify_release(api(endpoint), release_id, notes, {}, True)
        assets = {path.name: path.read_bytes() for path in (archive, checksum)}
        for path in (archive, checksum):
            run("gh", "api", "--hostname", "github.com", "--method", "POST",
                f"https://uploads.github.com/{endpoint}/assets?name={quote(path.name)}",
                "--header", "Content-Type: application/octet-stream", "--input", str(path))
        draft = api(endpoint)
        asset_ids = verify_release(draft, release_id, notes, assets, True)
        for asset in draft["assets"]:
            downloaded = api(f"repos/{REPO}/releases/assets/{asset['id']}", binary=True)
            require(downloaded == assets[asset["name"]], f"Downloaded asset differs for {asset['name']}")
            (directory / ("downloaded-" + asset["name"])).write_bytes(downloaded)
        require(hashlib.sha256((directory / ("downloaded-" + archive.name)).read_bytes()).hexdigest() ==
                (directory / ("downloaded-" + checksum.name)).read_text().split()[0],
                "Downloaded archive checksum differs")
        require(remote_tag(sha) == tag_object, "Remote tag object changed before publication")
        require(verify_release(api(endpoint), release_id, notes, assets, True) == asset_ids,
                "Verified draft asset IDs changed")
        published = api(endpoint, {"draft": False, "prerelease": False, "make_latest": "true"})
        require(verify_release(published, release_id, notes, assets, False) == asset_ids,
                "Published asset IDs changed")
        for path in (f"tags/{TAG}", "latest"):
            require(verify_release(api(f"repos/{REPO}/releases/{path}"),
                                   release_id, notes, assets, False) == asset_ids,
                    "Published asset IDs changed")
        require(remote_tag(sha) == tag_object, "Remote tag object changed after publication")
        print(f"Published https://github.com/{REPO}/releases/tag/{TAG}")
        print(f"Commit {sha}; tag object {tag_object}; release ID {release_id}; archive SHA256 {digest}")


if __name__ == "__main__":
    try:
        require(sys.argv[1:] in (["validate"], ["publish"]), "Usage: release-v3.py validate|publish")
        sha, notes = validate()
        if sys.argv[1] == "publish":
            publish(sha, notes)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release stopped: {error}", file=sys.stderr)
        sys.exit(1)

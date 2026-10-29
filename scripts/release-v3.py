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
import time
from urllib.parse import quote


REPO = "tmcfarlane/flowchart"
TAG = "v3.0.0"
VERSION = "3.0.0"
MEDIA = f"public/releases/{TAG}"
NOTES = f"docs/releases/{TAG}.md"
RAW = f"https://raw.githubusercontent.com/{REPO}/{TAG}/{MEDIA}/"
RECOVERY = {
    "id": 427372503,
    "commit": "d9304ff2b509c7d96eb01bed26a3845ba7d504fd",
    "tag_object": "c1d9a9f8dc7413c67749d5e03688bd38715f7f3a",
    "notes_sha256": "c42119aa6875424fd70a2579c11d0a3618893fbb00adce9f6cc71993fb5f7cae",
}
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


def committed(path, sha):
    return run("git", "show", f"{sha}:{path}")


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            attrs = dict(attrs)
            self.images.append((attrs.get("alt", ""), attrs.get("src", "")))


def validate(recovery=False):
    expected = {
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_REF": "refs/heads/main" if recovery else f"refs/tags/{TAG}",
        "GITHUB_REF_TYPE": "branch" if recovery else "tag",
        "GITHUB_REF_NAME": "main" if recovery else TAG,
        "GITHUB_EVENT_NAME": "push",
    }
    for name, value in expected.items():
        require(os.environ.get(name) == value, f"Expected {name}={value}")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    require(event.get("deleted") is False, "Deleted refs cannot publish")
    if recovery:
        require(event.get("forced") is False, "Forced main pushes cannot recover")
    else:
        require(event.get("created") is True, "Only a newly created tag can publish")
    require(event.get("ref") == expected["GITHUB_REF"], "Event ref differs")
    sha = os.environ.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "Expected a full commit SHA")
    require(git("rev-parse", "HEAD") == sha, "HEAD differs from event commit")
    if recovery:
        run("git", "merge-base", "--is-ancestor", RECOVERY["commit"], sha)
        sha = RECOVERY["commit"]
        require(git("rev-parse", f"refs/tags/{TAG}") == RECOVERY["tag_object"],
                "Recovery tag object differs")
    require(git("rev-parse", f"{TAG}^{{commit}}") == sha, "Tag differs from event commit")
    run("git", "merge-base", "--is-ancestor", sha, "origin/main")
    package = json.loads(committed("package.json", sha))
    lock = json.loads(committed("package-lock.json", sha))
    require(package.get("version") == lock.get("version") ==
            lock.get("packages", {}).get("", {}).get("version") == VERSION,
            "Package and lock versions must all be 3.0.0")
    paths = git("ls-tree", "-r", "--name-only", sha, "--", MEDIA).splitlines()
    pngs = {path for path in paths if path.lower().endswith(".png")}
    require(pngs == {f"{MEDIA}/{name}" for name in IMAGES}, "Screenshot set differs")
    manifest = committed(f"{MEDIA}/SHA256SUMS", sha).decode()
    hashes = {}
    for line in manifest.splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([a-z0-9-]+\.png)", line)
        require(match is not None, "Invalid SHA256SUMS entry")
        digest, name = match.groups()
        require(name not in hashes, "Duplicate SHA256SUMS entry")
        hashes[name] = digest
    require(hashes.keys() == IMAGES.keys(), "SHA256SUMS screenshot set differs")
    for name, dimensions in IMAGES.items():
        image = committed(f"{MEDIA}/{name}", sha)
        require(image[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" and len(image) >= 33,
                f"Invalid PNG signature or header for {name}")
        require(struct.unpack(">II", image[16:24]) == dimensions, f"Wrong dimensions for {name}")
        require(hashlib.sha256(image).hexdigest() == hashes[name], f"Checksum differs for {name}")
    notes_bytes = committed(NOTES, sha)
    if recovery:
        require(hashlib.sha256(notes_bytes).hexdigest() == RECOVERY["notes_sha256"],
                "Recovery notes checksum differs")
    notes = notes_bytes.decode("utf-8")
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


def api(endpoint, payload=None, binary=False, method="PATCH"):
    args = ["gh", "api", "--hostname", "github.com", endpoint]
    if payload is not None:
        args.extend(["--method", method, "--input", "-"])
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
    if draft:
        require(release.get("published_at") is None, "Draft already has a publication date")
    else:
        require(release.get("published_at"), "Release has no publication date")
    remote_assets = release.get("assets")
    require(isinstance(remote_assets, list), "Invalid release asset list")
    require(len(remote_assets) == len(assets), "Release asset count differs")
    require({asset.get("name") for asset in remote_assets} == assets.keys(),
            "Release asset names differ")
    for asset in remote_assets:
        require(type(asset.get("id")) is int and asset["id"] > 0,
                "Invalid release asset ID")
        require(asset.get("state") == "uploaded" and
                asset.get("size") == len(assets[asset["name"]]), "Release asset state or size differs")
    return {asset["name"]: asset["id"] for asset in remote_assets}


def finish_draft(sha, notes, release_id, tag_object):
    endpoint = f"repos/{REPO}/releases/{release_id}"
    verify_release(api(endpoint), release_id, notes, {}, True)
    with tempfile.TemporaryDirectory(prefix="flowchart-release-") as directory:
        directory = Path(directory)
        archive = directory / f"flowchart-{TAG}-screenshots.zip"
        run("git", "archive", "--format=zip", f"--output={archive}", sha, MEDIA)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        checksum = archive.with_suffix(".zip.sha256")
        checksum.write_text(f"{digest}  {archive.name}\n")
        require(remote_tag(sha) == tag_object, "Remote tag object changed before upload")
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
        require(verify_release(api(f"repos/{REPO}/releases/tags/{TAG}"),
                               release_id, notes, assets, False) == asset_ids,
                "Published asset IDs changed")
        for attempt in range(5):
            latest = api(f"repos/{REPO}/releases/latest")
            latest_id = latest.get("id")
            older_stable = (type(latest_id) is int and 0 < latest_id < release_id and
                            latest.get("tag_name") != TAG and latest.get("draft") is False and
                            latest.get("prerelease") is False and latest.get("published_at"))
            if not older_stable or attempt == 4:
                break
            time.sleep(2)
        require(verify_release(latest, release_id, notes, assets, False) == asset_ids,
                "Published asset IDs changed")
        require(remote_tag(sha) == tag_object, "Remote tag object changed after publication")
        print(f"Published https://github.com/{REPO}/releases/tag/{TAG}")
        print(f"Commit {sha}; tag object {tag_object}; release ID {release_id}; archive SHA256 {digest}")


def publish(sha, notes):
    require(os.environ.get("GH_TOKEN"), "GH_TOKEN is required")
    require(not releases(), "An existing release or draft already uses v3.0.0; left untouched")
    tag_object = remote_tag(sha)
    created = api(f"repos/{REPO}/releases", {
        "tag_name": TAG,
        "target_commitish": sha,
        "name": TAG,
        "body": notes,
        "draft": True,
        "prerelease": False,
        "make_latest": "false",
    }, method="POST")
    release_id = created.get("id")
    verify_release(created, release_id, notes, {}, True)
    print(f"Created draft release {release_id}; failures leave it unpublished", flush=True)
    finish_draft(sha, notes, release_id, tag_object)


def recover(sha, notes):
    require(os.environ.get("GH_TOKEN"), "GH_TOKEN is required")
    require(sha == RECOVERY["commit"], "Recovery source commit differs")
    tag_object = remote_tag(sha)
    require(tag_object == RECOVERY["tag_object"], "Remote recovery tag object differs")
    print(f"Recovering existing draft {RECOVERY['id']}; failures leave it unpublished", flush=True)
    finish_draft(sha, notes, RECOVERY["id"], tag_object)


if __name__ == "__main__":
    try:
        require(sys.argv[1:] in (["validate"], ["publish"], ["recover"]),
                "Usage: release-v3.py validate|publish|recover")
        sha, notes = validate(recovery=sys.argv[1] == "recover")
        if sys.argv[1] == "publish":
            publish(sha, notes)
        elif sys.argv[1] == "recover":
            recover(sha, notes)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release stopped: {error}", file=sys.stderr)
        sys.exit(1)

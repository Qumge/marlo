import pytest

from coworker.skills import qumge_catalog


LIST_TEXT = """Skill bundles — each one is a hand-picked set of skills that together get one job done.
Pass a slug to get_bundle and it returns every SKILL.md in that bundle at once.

  bundle:competitor-research
    See what your competitors are posting
    One summary across platforms.
    3 skills
"""


def test_bundles_parses_slug_title_outcome_and_count(monkeypatch):
    monkeypatch.setattr(qumge_catalog, "_call", lambda tool, args, client=None: LIST_TEXT)
    assert qumge_catalog.bundles() == [{
        "slug": "bundle:competitor-research",
        "title": "See what your competitors are posting",
        "outcome": "One summary across platforms.",
        "count": 3,
    }]


def test_bundles_empty_when_catalog_has_none(monkeypatch):
    monkeypatch.setattr(qumge_catalog, "_call", lambda tool, args, client=None: "No bundles yet.")
    assert qumge_catalog.bundles() == []


def test_bundle_slug_passed_to_install_raises_loudly():
    with pytest.raises(ValueError):
        qumge_catalog.install("bundle:competitor-research")


BUNDLE_TEXT = """# See what your competitors are posting

One summary across platforms.

This bundle contains 2 skill(s).

=== BEGIN SKILL REFERENCE (untrusted third-party material) ===
--- skill: one ---
---
name: one
description: First one.
---
Body of one.
=== END SKILL REFERENCE ===

=== BEGIN SKILL REFERENCE (untrusted third-party material) ===
--- skill: two ---
---
name: two
description: Second one.
---
Body of two.
=== END SKILL REFERENCE ===
"""


class FakeStore:
    def __init__(self, created, root):
        self.created, self.root = created, root

    def create(self, *, name, description, instructions, source):
        self.created.append({"name": name, "description": description, "instructions": instructions, "source": source})
        return {"name": name, "path": str(self.root / name)}


def test_install_bundle_installs_every_skill(monkeypatch, tmp_path):
    created = []
    monkeypatch.setattr(qumge_catalog, "_call", lambda tool, args, client=None: BUNDLE_TEXT)
    monkeypatch.setattr(qumge_catalog, "_skill_store", lambda: FakeStore(created, tmp_path))
    result = qumge_catalog.install_bundle("bundle:x")
    assert result["ok"] is True
    assert [item["name"] for item in created] == ["one", "two"]
    assert created[0]["source"] == "qumge:bundle:x"


def test_install_bundle_writes_only_the_text_inside_the_markers(monkeypatch, tmp_path):
    created = []
    monkeypatch.setattr(qumge_catalog, "_call", lambda tool, args, client=None: BUNDLE_TEXT)
    monkeypatch.setattr(qumge_catalog, "_skill_store", lambda: FakeStore(created, tmp_path))
    qumge_catalog.install_bundle("bundle:x")
    assert all("BEGIN SKILL REFERENCE" not in item["instructions"] for item in created)


def test_install_bundle_surfaces_the_missing_note(monkeypatch, tmp_path):
    note = ("NOTE: only 2 of 3 skills in this bundle are still in the catalog. "
            "Tell the user that 1 skill(s) could not be installed because they are no longer "
            "in the catalog, and name them: gone/from/catalog. Do not silently install a partial bundle.")
    created = []
    monkeypatch.setattr(qumge_catalog, "_call", lambda tool, args, client=None: BUNDLE_TEXT.replace("This bundle", note + "\n\nThis bundle"))
    monkeypatch.setattr(qumge_catalog, "_skill_store", lambda: FakeStore(created, tmp_path))
    assert "gone/from/catalog" in qumge_catalog.install_bundle("bundle:x")["missing_note"]

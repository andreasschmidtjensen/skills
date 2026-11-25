#!/usr/bin/env python3
# Item operations for todo.sh on one list file (sub-to-dos: 2 spaces per level, max depth 3).
#   todo-items.py <file> show
#   todo-items.py <file> has                      exit 0 if the list has items
#   todo-items.py <file> add <parent|-> <due|-> <text>
#   todo-items.py <file> done|undo|rm <ref>       prints the text of each item changed
#   todo-items.py <file> edit <ref> <new text>    prints the old text
#   todo-items.py <file> clear
# <ref> is a path (1, 1.2, 1.2.1) or an item's exact text. Errors: stderr, exit 1.
import datetime, os, re, sys

ITEM = re.compile(r"^( *)- \[( |x)\] (.*)$")
MAXDEPTH = 3


def die(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(1)


def plain(s):
    return re.sub(r" *<!--[^>]*-->", "", s)


def load(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read().split("\n")


def save(path, lines):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    os.replace(tmp, path)


def parse(lines):
    """Items: dicts with line index, depth (clamped), number path, tick, raw text."""
    items, counters, prev = [], [], -1
    for i, l in enumerate(lines):
        m = ITEM.match(l)
        if not m:
            continue
        d = min(len(m.group(1)) // 2, prev + 1, MAXDEPTH - 1)
        del counters[d + 1:]
        while len(counters) <= d:
            counters.append(0)
        counters[d] += 1
        prev = d
        items.append({"line": i, "depth": d, "path": ".".join(map(str, counters)), "done": m.group(2) == "x", "rest": m.group(3)})
    return items


def subtree(items, k):
    end = k + 1
    while end < len(items) and items[end]["depth"] > items[k]["depth"]:
        end += 1
    return range(k, end)


def resolve(items, ref):
    if re.fullmatch(r"[0-9]+(\.[0-9]+)*\.?", ref):
        want = ref.rstrip(".")
        for k, it in enumerate(items):
            if it["path"] == want:
                return k
        die("No item " + ref)
    for k, it in enumerate(items):
        if plain(it["rest"]) == ref:
            return k
    die('No item "%s"' % ref)


def main():
    path, op, args = sys.argv[1], sys.argv[2], sys.argv[3:]
    lines = load(path)
    if lines is None:
        if op in ("show", "has"):
            sys.exit(1)
        if op == "add":
            lines = []
        else:
            die("No item " + (args[0] if args else ""))
    items = parse(lines)
    if op == "has":
        sys.exit(0 if items else 1)
    if op == "show":
        for it in items:
            due = re.search(r"<!-- due: ([^>]*) -->", it["rest"])
            on = re.search(r"<!-- done: ([^>]*) -->", it["rest"])
            print("%s%s. [%s] %s%s%s" % ("  " * it["depth"], it["path"], "x" if it["done"] else " ", plain(it["rest"]),
                                         "  (due %s)" % due.group(1) if due else "", "  (done %s)" % on.group(1) if on else ""))
        return
    if op == "add":
        parent, due, text = args
        new = "- [ ] %s%s" % (text, " <!-- due: %s -->" % due if due != "-" else "")
        if parent == "-":
            at, indent = len(lines), ""
            while at > 0 and lines[at - 1] == "":  # trailing blank lines stay below the new item
                at -= 1
        else:
            k = resolve(items, parent)
            if items[k]["depth"] + 1 >= MAXDEPTH:
                die("Too deep: sub-to-dos go at most %d levels" % MAXDEPTH)
            at = items[subtree(items, k)[-1]]["line"] + 1
            indent = "  " * (items[k]["depth"] + 1)
        lines.insert(at, indent + new)
        if lines[-1] != "":  # the file had no trailing newline
            lines.append("")
        save(path, lines)
        return
    if op == "clear":
        drop, k = set(), 0
        while k < len(items):
            r = subtree(items, k)
            if all(items[j]["done"] for j in r):
                drop.update(items[j]["line"] for j in r)
                k = r[-1] + 1
            else:
                k += 1
        if drop:
            save(path, [l for i, l in enumerate(lines) if i not in drop])
        return
    if not args:
        die("usage: item number or text")
    k = resolve(items, args[0])
    it = items[k]
    if op == "resolve":
        print(plain(it["rest"]))
    elif op == "rm":
        r = subtree(items, k)
        for j in r:
            print(plain(items[j]["rest"]))
        drop = {items[j]["line"] for j in r}
        save(path, [l for i, l in enumerate(lines) if i not in drop])
    elif op == "done":
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        for j in subtree(items, k):
            x = items[j]
            if not x["done"]:
                lines[x["line"]] = "%s- [x] %s <!-- done: %s -->" % (re.match(r" *", lines[x["line"]]).group(0), x["rest"], stamp)
                print(plain(x["rest"]))
        save(path, lines)
    elif op == "undo":
        if it["done"]:
            rest = re.sub(r" *<!-- done: [^>]*-->", "", it["rest"])
            lines[it["line"]] = "%s- [ ] %s" % (re.match(r" *", lines[it["line"]]).group(0), rest)
            print(plain(it["rest"]))
            save(path, lines)
    elif op == "edit":
        rest = it["rest"]
        c = rest.find("<!--")
        tail = " " + rest[c:] if c >= 0 else ""
        lines[it["line"]] = ("%s- [%s] %s%s" % (re.match(r" *", lines[it["line"]]).group(0), "x" if it["done"] else " ", args[1], tail)).rstrip()
        print(plain(rest))
        save(path, lines)
    else:
        die("unknown op " + op)


main()

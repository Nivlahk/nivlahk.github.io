export const SAMPLES = {
  python: {
    'Checkout (blocks & notes)': `def checkout(cart, coupon=None):
    # note Subtotal #3b82f6
    subtotal = 0
    for item in cart:
        if item["qty"] <= 0:
            continue
        subtotal += item["price"] * item["qty"]


    # note Discounts #a855f7
    discount = 0
    if coupon == "HALF":
        discount = subtotal / 2
    elif coupon:
        print("unknown coupon", coupon)


    # note Total #22c55e
    total = subtotal - discount
    print("total", total)
    return round(total, 2)
`,
    'Binary search': `def binary_search(items, target):
    lo, hi = 0, len(items) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if items[mid] == target:
            return mid
        elif items[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
`,
    'Inventory class': `class Inventory:
    def __init__(self, owner):
        self.owner = owner
        self.items = {}
        self.log = []

    def add(self, name, qty=1):
        if qty <= 0:
            raise ValueError("qty must be positive")
        current = self.items.get(name, 0)
        self.items[name] = current + qty
        self.log.append(("add", name, qty))
        return self.items[name]

    def remove(self, name, qty=1):
        have = self.items.get(name, 0)
        if have < qty:
            return False
        self.items[name] = have - qty
        if self.items[name] == 0:
            del self.items[name]
        self.log.append(("remove", name, qty))
        return True

    def restock(self, order):
        for name, qty in order.items():
            self.add(name, qty)
        return self.summary()

    def summary(self):
        total = sum(self.items.values())
        return f"{self.owner}: {total} units"


def run():
    inv = Inventory("niv")
    inv.restock({"bolts": 40, "nuts": 12})
    inv.remove("nuts", 5)
    print(inv.summary())
`,
    'Parse config (try/with)': `import json

def load_config(path, defaults):
    config = dict(defaults)
    try:
        with open(path) as fh:
            raw = json.load(fh)
    except FileNotFoundError:
        return config
    except json.JSONDecodeError as err:
        print("bad config:", err)
        raise
    else:
        for key, value in raw.items():
            if key.startswith("_"):
                continue
            if key not in config:
                print("unknown key", key)
                break
            config[key] = value
    finally:
        print("loaded", path)
    debug = config.get("debug", False)
    return config
`,
    'Fibonacci + dead store': `def fib(n):
    a, b = 0, 1
    count = 0
    unused = n * 2
    for _ in range(n):
        a, b = b, a + b
        count += 1
    return a
`,
    'Match / walrus': `def handle(command, queue):
    match command.split():
        case ["go", direction]:
            queue.append(direction)
        case ["quit"]:
            return None
        case _:
            print("unknown")
    while (job := queue.pop() if queue else None) is not None:
        print("running", job)
    return len(queue)
`,
  },
  javascript: {
    'Debounced search': `function search(items, query, limit = 10) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const item of items) {
    if (hits.length >= limit) break;
    const name = item.name.toLowerCase();
    if (name.includes(q)) {
      hits.push({ item, score: name.indexOf(q) });
    } else if (item.tags && item.tags.some((t) => t === q)) {
      hits.push({ item, score: 100 });
    }
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.map((h) => h.item);
}
`,
    'Class + switch': `class Machine {
  constructor(start) {
    this.state = start;
    this.history = [];
  }

  step(event) {
    let next = this.state;
    switch (this.state) {
      case "idle":
        if (event === "go") next = "running";
        break;
      case "running":
        if (event === "pause") { next = "paused"; break; }
      case "paused":
        next = event === "stop" ? "idle" : this.state;
        break;
      default:
        throw new Error("bad state " + this.state);
    }
    this.history.push(next);
    this.state = next;
    return this.log(next);
  }

  log(s) {
    console.log("state:", s);
    return s;
  }
}

function drive(m, events) {
  for (let i = 0; i < events.length; i++) {
    try {
      m.step(events[i]);
    } catch (e) {
      console.error(e);
      continue;
    } finally {
      console.log("tick", i);
    }
  }
}
`,
  },
};

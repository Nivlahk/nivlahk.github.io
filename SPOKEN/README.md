# SPOKEN

Mutter, an English-like programming language you can read aloud and write by voice. One page holds the editor, a console, a Screen for small apps, a keyword guide and a voice guide.

Live: https://calvinhancock.com/SPOKEN/

```
define greet with name
    give "Hello, " + name + "!"

class Animal with name
    define speak
        give self.name

class Dog with breed extends Animal
    define speak
        give take.speak + " barks!"

make rex a Dog with "Rex", "Husky"
print rex.speak
print greet("Ada")
```

## What it does

- **Reads like English.** Blocks are indentation, `make` sets a variable, `give` returns, `each` loops, `if votes mostly yes` asks a list a question. Declarations use `with` (`define add with a, b`); calls use parentheses (`add(2, 3)`), or nothing when there are no arguments (`name.upper`).
- **Voice input.** Tap the mic and talk. Spoken words like `pair`, `quote`, `dot`, `comma`, `then` and `tag` type the symbols, so you can write a program without the keyboard. The Voice Guide lists them all.
- **Plain-language errors.** Mistakes point at the line and say what to write instead.
- **Packages from other languages.** `use python numpy as np` loads Python in the browser (the standard library, numpy, pandas, and pure-Python packages from PyPI). `use js lodash as lo` loads an npm package. `use "https://.../file.vx"` loads Mutter code.
- **Screen and events.** Every `#name` is an element on the Screen: a label, button, text box or canvas. `bind #app.text counter` keeps it up to date, `on click "#go-btn"` and `every 30 ms` run blocks, and the program keeps running until you press Stop.
- **Methods and built-ins.** Text, list and dictionary methods (`s.replace("a", "b")`, `items.sort`, `d.keys`), conversions with `as` (`x as int`), and a small set of built-in functions (`random`, `pick`, `min`, `max`, `round`, `range`, ...).

## Running it

It's one self-contained HTML file: open `index.html` in a browser, or use the live link. Voice input uses the browser's Web Speech API and works best in Chrome or Edge. The editor (Monaco) loads from cdnjs. Python loads from jsDelivr and npm packages from esm.sh, only when a program uses them.

Packages run inside the page with the same access the page has, so only use ones you trust.

One-line: path analysis across properties — where a person entered, what they touched, where they left.

```jsx
<SankeyDiagram height={260}
  nodes={[{id:"search",label:"Search",column:0},{id:"docs",label:"docs.falorb.io",column:1},{id:"install",label:"Copied snippet",column:2}]}
  links={[{from:"search",to:"docs",value:6209},{from:"docs",to:"install",value:1204}]} />
```

Ribbons sit at 13% opacity; hovering one lifts it to 42% and dims the rest, with a glass readout top-right.
Layout is derived from the data — don't hand-place nodes. 3–4 columns is the readable limit.

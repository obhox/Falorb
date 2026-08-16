One-line: switches views inside one page — Summary / Sessions / People / Events.

```jsx
<Tabs tabs={["Summary","Sessions",{value:"People",label:"People",count:1284}]} value={tab} onChange={setTab} />
```

Active tab is white text + a 1.5px white underline. Never colour the underline glacier.

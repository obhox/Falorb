One-line: comparing two or three trends over time — the default when a hatched bar chart would be too heavy.

```jsx
<LineChart labels={months} series={[
  { name: "Visitors", data: v, fill: true },
  { name: "Sessions", data: s, color: "var(--series-2)" }
]} />
```

Max three series. Series 1 is glacier (the one in focus); everything else comes from the graphite ramp.

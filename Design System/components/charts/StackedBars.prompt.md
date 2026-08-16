One-line: composition over time — traffic by source, events by type, sessions by device.

```jsx
<StackedBars data={byMonth} series={[{name:"Direct"},{name:"Search",color:"var(--series-2)"},{name:"Social",color:"var(--series-4)"}]} />
```

Hovering one column dims the rest. Keep to 4 segments; beyond that use a DonutChart or a breakdown list.

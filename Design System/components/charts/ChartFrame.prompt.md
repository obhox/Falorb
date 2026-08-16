One-line: wraps any chart so titles, controls and legends land identically everywhere.

```jsx
<ChartFrame title="Visitors vs sessions" subtitle="Last 12 months" height={200}
  actions={<Select size="sm" value="Monthly" options={["Daily","Weekly","Monthly"]} />}
  legend={<Legend items={[{label:"Visitors"},{label:"Sessions",color:"var(--series-2)"}]} />}>
  <LineChart series={series} labels={labels} />
</ChartFrame>
```

Never hand-roll a chart card. The frame is flex-column, so charts inside it fill available height.

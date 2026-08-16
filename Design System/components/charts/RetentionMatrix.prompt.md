One-line: cohort retention triangle — do the people who arrived in a given week come back?

```jsx
<RetentionMatrix periodLabel="Week" cohorts={[
  { label: "Aug 4 – Aug 10", size: 1284, values: [100, 42, 31, 24] },
  { label: "Aug 11 – Aug 17", size: 1102, values: [100, 38, 29] }
]} />
```

Shorter `values` arrays leave future cells blank — that's the triangle, not missing data.

One-line: shown whenever a query returns nothing — always says why and what to do next.

```jsx
<EmptyState icon={<Icon name="search-x" />} title="No sessions match these filters"
  body="Try widening the range to 30 days, or drop the country filter."
  action={<Button size="sm">Reset filters</Button>} />
```

Never a bare "No data available". Cause + remedy, one sentence each.

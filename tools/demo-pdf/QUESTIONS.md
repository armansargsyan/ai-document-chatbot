# Demo video questions

Questions to ask the chatbot about [`acme-employee-handbook.pdf`](acme-employee-handbook.pdf) (14 pages, fictional) in the product video. Page numbers are the PDF's own page numbers, which is what the chat citations show.

Each fact appears exactly once in the handbook, so every answer should cite a single, predictable page. `node tools/demo-pdf/build.mjs` checks this every time it rebuilds the PDF and prints the page of each fact.

## 1. Simple

> How many vacation days do new employees get?

**Expected answer:** 20 vacation days per year, rising to 25 after 3 years of continuous service.

**Source:** page 6, section 4.1 "Annual vacation entitlement".

## 2. Specific

> What's the daily meal limit when traveling, and when do I submit receipts?

**Expected answer:** Meals are reimbursed up to $60 per day, and receipts must be submitted within 14 days of the end of the trip.

**Source:** page 11, section 8 "Travel & Expenses", under "Meals while traveling".

## 3. Tricky (combines two parts of the handbook)

> I've worked here 4 years and have 7 unused days. How many vacation days can I use next year?

**Expected answer:** 30 days. After 3 years the yearly entitlement is 25 days. Only 5 of the 7 unused days carry over, so the other 2 are forfeited, and the 5 carried-over days must be used by March 31.

**Sources:** both pages should be cited:

- page 6, section 4.1: 25 days after 3 years
- page 7, section 4.4 "Carrying over unused vacation": up to 5 days, used by March 31

## Other facts in the handbook (for extra takes)

| Question idea                             | Answer                                                 | Page |
| ----------------------------------------- | ------------------------------------------------------ | ---- |
| How many days a week can I work remotely? | Up to 3 days per week, with team lead approval         | 5    |
| How many paid sick days do I get?         | 10; a doctor's note is needed after 3 consecutive days | 8    |
| What's my budget for a new laptop?        | $1,500 every 2 years for a laptop and accessories      | 10   |
| When are performance reviews?             | Twice a year, in June and December                     | 12   |

## Rebuilding the PDF

```sh
node tools/demo-pdf/build.mjs
```

This needs Chrome or Chromium installed; set `CHROME_PATH` if it's not in a standard location. If you edit the content, check that the page numbers in this file still match the script's output.

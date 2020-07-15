# pg-schema-dump

utility to dump pg database schema into text comparable format

## test coverage

| Statements | Branches | Functions | Lines |
| -----------|----------|-----------|-------|
| ![Statements](https://img.shields.io/badge/Coverage-58.75%25-red.svg "Make me better!") | ![Branches](https://img.shields.io/badge/Coverage-35%25-red.svg "Make me better!") | ![Functions](https://img.shields.io/badge/Coverage-54.05%25-red.svg "Make me better!") | ![Lines](https://img.shields.io/badge/Coverage-59.44%25-red.svg "Make me better!") |

## installation

```
npm install -g @pureprofile/pg-schema-dump
```

## usage

```
pg-schema-dump --url postgres://username:password@my-database.my-domain/database-name --out ./dump-my-db-here
```

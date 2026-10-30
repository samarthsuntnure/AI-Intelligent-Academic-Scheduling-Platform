# Local Database Setup

This project uses MySQL Server and can be managed with MySQL Workbench. XAMPP is not required.

1. Create the database once in Workbench:

```sql
CREATE DATABASE IF NOT EXISTS vidyaan;
```

2. Copy `../.env.example` to `../.env` and set the real MySQL password.
3. From the project root run `pnpm db:push`.
4. Run `pnpm import-csv -- --reset` to load the bundled institutional sample data.

The API performs small idempotent startup migrations for the additional planning tables and ensures the local admin account exists.

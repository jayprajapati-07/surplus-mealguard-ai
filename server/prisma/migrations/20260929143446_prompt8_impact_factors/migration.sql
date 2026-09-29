-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImpactFactor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "value" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "source" TEXT,
    "effectiveDate" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT,
    "category" TEXT,
    "foodItemId" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ImpactFactor" ("description", "id", "key", "unit", "updatedAt", "value") SELECT "description", "id", "key", "unit", "updatedAt", "value" FROM "ImpactFactor";
DROP TABLE "ImpactFactor";
ALTER TABLE "new_ImpactFactor" RENAME TO "ImpactFactor";
CREATE UNIQUE INDEX "ImpactFactor_key_organizationId_category_foodItemId_key" ON "ImpactFactor"("key", "organizationId", "category", "foodItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

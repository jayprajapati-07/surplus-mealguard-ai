-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyFoodRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT NOT NULL,
    "foodItemId" TEXT,
    "date" DATETIME NOT NULL,
    "mealType" TEXT NOT NULL,
    "targetKg" REAL,
    "preparedKg" REAL NOT NULL,
    "servedKg" REAL NOT NULL,
    "soldKg" REAL,
    "wasteKg" REAL NOT NULL,
    "remainingKg" REAL,
    "adjustmentReason" TEXT,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "correctionReason" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyFoodRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyFoodRecord_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyFoodRecord_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DailyFoodRecord" ("createdAt", "date", "id", "kitchenUnitId", "mealType", "notes", "organizationId", "preparedKg", "servedKg", "wasteKg") SELECT "createdAt", "date", "id", "kitchenUnitId", "mealType", "notes", "organizationId", "preparedKg", "servedKg", "wasteKg" FROM "DailyFoodRecord";
DROP TABLE "DailyFoodRecord";
ALTER TABLE "new_DailyFoodRecord" RENAME TO "DailyFoodRecord";
CREATE INDEX "DailyFoodRecord_organizationId_date_idx" ON "DailyFoodRecord"("organizationId", "date");
CREATE TABLE "new_FoodItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mealType" TEXT,
    "standardPortionKg" REAL,
    "sellingPrice" REAL,
    "recipeText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FoodItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FoodItem" ("category", "createdAt", "id", "name", "organizationId", "unit", "updatedAt") SELECT "category", "createdAt", "id", "name", "organizationId", "unit", "updatedAt" FROM "FoodItem";
DROP TABLE "FoodItem";
ALTER TABLE "new_FoodItem" RENAME TO "FoodItem";
CREATE UNIQUE INDEX "FoodItem_organizationId_name_key" ON "FoodItem"("organizationId", "name");
CREATE TABLE "new_Menu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "date" DATETIME NOT NULL,
    "mealType" TEXT NOT NULL,
    "title" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'DAILY',
    "isSpecial" BOOLEAN NOT NULL DEFAULT false,
    "specialLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Menu_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Menu_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Menu" ("createdAt", "date", "id", "kitchenUnitId", "mealType", "organizationId") SELECT "createdAt", "date", "id", "kitchenUnitId", "mealType", "organizationId" FROM "Menu";
DROP TABLE "Menu";
ALTER TABLE "new_Menu" RENAME TO "Menu";
CREATE INDEX "Menu_organizationId_date_idx" ON "Menu"("organizationId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

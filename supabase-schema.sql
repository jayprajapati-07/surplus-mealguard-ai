-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "organizationId" TEXT,
    "ngoOrganizationId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "resetToken" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "institutionType" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "operatingHours" TEXT NOT NULL,
    "peopleServedDaily" INTEGER NOT NULL,
    "kitchenCapacityKg" DOUBLE PRECISION NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "notes" TEXT,
    "dietaryFocus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenUnit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mealTimings" TEXT NOT NULL,
    "storageAreas" TEXT NOT NULL,
    "foodCategories" TEXT NOT NULL,
    "productionCapacityKg" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mealType" TEXT,
    "standardPortionKg" DOUBLE PRECISION,
    "sellingPrice" DOUBLE PRECISION,
    "recipeText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "foodItemId" TEXT,
    "ingredientName" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "mealType" TEXT NOT NULL,
    "title" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'DAILY',
    "isSpecial" BOOLEAN NOT NULL DEFAULT false,
    "specialLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "foodItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyFoodRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT NOT NULL,
    "foodItemId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "mealType" TEXT NOT NULL,
    "targetKg" DOUBLE PRECISION,
    "preparedKg" DOUBLE PRECISION NOT NULL,
    "servedKg" DOUBLE PRECISION NOT NULL,
    "soldKg" DOUBLE PRECISION,
    "wasteKg" DOUBLE PRECISION NOT NULL,
    "remainingKg" DOUBLE PRECISION,
    "adjustmentReason" TEXT,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "correctionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyFoodRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodFlowEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "foodItemId" TEXT,
    "stage" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mealType" TEXT,
    "entryKind" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "direction" TEXT NOT NULL DEFAULT 'ADD',
    "refKind" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,

    CONSTRAINT "FoodFlowEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "foodItemId" TEXT,
    "batchCode" TEXT,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "storageArea" TEXT,
    "supplier" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "predictedDemandKg" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'HISTORICAL_AVG',
    "inputsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndOfDayReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "totalPreparedKg" DOUBLE PRECISION NOT NULL,
    "totalServedKg" DOUBLE PRECISION NOT NULL,
    "totalWasteKg" DOUBLE PRECISION NOT NULL,
    "totalSurplusKg" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FINAL',
    "accuracyJson" TEXT,
    "qualityNotes" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EndOfDayReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurplusEligibilityAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "foodDescription" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "recordedInfoJson" TEXT,
    "humanConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "assessedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurplusEligibilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NgoOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "acceptedCategories" TEXT,
    "pickupCapable" BOOLEAN NOT NULL DEFAULT true,
    "operatingHours" TEXT,
    "capacityKg" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NgoOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NgoMatch" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasonsJson" TEXT,
    "deliveryJson" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NgoMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "token" TEXT,
    "linkPath" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedistributionRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT,
    "ngoId" TEXT,
    "assessmentId" TEXT,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "pickupAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedistributionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactFactor" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "source" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT,
    "category" TEXT,
    "foodItemId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImpactFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "foodSavedKg" DOUBLE PRECISION NOT NULL,
    "wasteReducedKg" DOUBLE PRECISION NOT NULL,
    "co2AvoidedKgEstimate" DOUBLE PRECISION NOT NULL,
    "costSavedEstimate" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER,
    "successRows" INTEGER,
    "errorRows" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRowError" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawDataJson" TEXT,
    "errorMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BufferConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BufferConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskThreshold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "medKg" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "highKg" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "minSales" INTEGER NOT NULL DEFAULT 2,
    "minSpanMin" INTEGER NOT NULL DEFAULT 30,
    "windowsJson" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryThreshold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lowStockKg" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "nearExpiryDays" INTEGER NOT NULL DEFAULT 3,
    "excessKg" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "minQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitchenUnitId" TEXT NOT NULL,
    "foodItemId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "predictedKg" DOUBLE PRECISION NOT NULL,
    "bufferKg" DOUBLE PRECISION NOT NULL,
    "recommendedKg" DOUBLE PRECISION NOT NULL,
    "adjustedKg" DOUBLE PRECISION,
    "adjustReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "memoryVersion" TEXT NOT NULL DEFAULT 'memory-v1',
    "inputsJson" TEXT,
    "feedbackJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_verificationToken_key" ON "User"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_ngoOrganizationId_idx" ON "User"("ngoOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE INDEX "Organization_city_idx" ON "Organization"("city");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationProfile_organizationId_key" ON "OrganizationProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenUnit_organizationId_name_key" ON "KitchenUnit"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_organizationId_name_key" ON "FoodItem"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RecipeIngredient_organizationId_idx" ON "RecipeIngredient"("organizationId");

-- CreateIndex
CREATE INDEX "Menu_organizationId_date_idx" ON "Menu"("organizationId", "date");

-- CreateIndex
CREATE INDEX "DailyFoodRecord_organizationId_date_idx" ON "DailyFoodRecord"("organizationId", "date");

-- CreateIndex
CREATE INDEX "FoodFlowEntry_organizationId_stage_idx" ON "FoodFlowEntry"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "InventoryItem_organizationId_idx" ON "InventoryItem"("organizationId");

-- CreateIndex
CREATE INDEX "EndOfDayReport_organizationId_date_idx" ON "EndOfDayReport"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "NgoOrganization_name_key" ON "NgoOrganization"("name");

-- CreateIndex
CREATE INDEX "NgoMatch_assessmentId_idx" ON "NgoMatch"("assessmentId");

-- CreateIndex
CREATE INDEX "NgoMatch_ngoId_idx" ON "NgoMatch"("ngoId");

-- CreateIndex
CREATE UNIQUE INDEX "NgoMatch_assessmentId_ngoId_key" ON "NgoMatch"("assessmentId", "ngoId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactFactor_key_organizationId_category_foodItemId_key" ON "ImpactFactor"("key", "organizationId", "category", "foodItemId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BufferConfig_organizationId_key" ON "BufferConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskThreshold_organizationId_key" ON "RiskThreshold"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryThreshold_organizationId_key" ON "InventoryThreshold"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityConfig_organizationId_key" ON "EligibilityConfig"("organizationId");

-- CreateIndex
CREATE INDEX "ProductionTarget_organizationId_date_idx" ON "ProductionTarget"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionTarget_organizationId_kitchenUnitId_foodItemId_me_key" ON "ProductionTarget"("organizationId", "kitchenUnitId", "foodItemId", "mealType", "date");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ngoOrganizationId_fkey" FOREIGN KEY ("ngoOrganizationId") REFERENCES "NgoOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationProfile" ADD CONSTRAINT "OrganizationProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenUnit" ADD CONSTRAINT "KitchenUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFoodRecord" ADD CONSTRAINT "DailyFoodRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFoodRecord" ADD CONSTRAINT "DailyFoodRecord_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFoodRecord" ADD CONSTRAINT "DailyFoodRecord_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodFlowEntry" ADD CONSTRAINT "FoodFlowEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodFlowEntry" ADD CONSTRAINT "FoodFlowEntry_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodFlowEntry" ADD CONSTRAINT "FoodFlowEntry_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndOfDayReport" ADD CONSTRAINT "EndOfDayReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndOfDayReport" ADD CONSTRAINT "EndOfDayReport_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurplusEligibilityAssessment" ADD CONSTRAINT "SurplusEligibilityAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurplusEligibilityAssessment" ADD CONSTRAINT "SurplusEligibilityAssessment_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurplusEligibilityAssessment" ADD CONSTRAINT "SurplusEligibilityAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NgoMatch" ADD CONSTRAINT "NgoMatch_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SurplusEligibilityAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NgoMatch" ADD CONSTRAINT "NgoMatch_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NgoOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedistributionRecord" ADD CONSTRAINT "RedistributionRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedistributionRecord" ADD CONSTRAINT "RedistributionRecord_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedistributionRecord" ADD CONSTRAINT "RedistributionRecord_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NgoOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedistributionRecord" ADD CONSTRAINT "RedistributionRecord_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SurplusEligibilityAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactSnapshot" ADD CONSTRAINT "ImpactSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowError" ADD CONSTRAINT "ImportRowError_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BufferConfig" ADD CONSTRAINT "BufferConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskThreshold" ADD CONSTRAINT "RiskThreshold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryThreshold" ADD CONSTRAINT "InventoryThreshold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityConfig" ADD CONSTRAINT "EligibilityConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTarget" ADD CONSTRAINT "ProductionTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTarget" ADD CONSTRAINT "ProductionTarget_kitchenUnitId_fkey" FOREIGN KEY ("kitchenUnitId") REFERENCES "KitchenUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTarget" ADD CONSTRAINT "ProductionTarget_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


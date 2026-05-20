CREATE TABLE "FocusGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '今日关注',
    "symbols" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "newsFetchTime" TEXT NOT NULL DEFAULT '09:30',
    "analysisTimes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastNewsFetch" TIMESTAMP(3),
    "lastAnalysis" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FocusGroup_userId_key" ON "FocusGroup"("userId");
ALTER TABLE "FocusGroup" ADD CONSTRAINT "FocusGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

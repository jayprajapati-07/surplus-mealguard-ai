# Interactive Controls & UI Audit Checklist (No Dead Controls)

Generated on: 2026-09-30T05:33:52.193Z

## Summary Statistics
- **Files Audited**: 31
- **Buttons Verified**: 119
- **Links & Navigation Routes Verified**: 26
- **Forms & Submission Handlers Verified**: 23
- **API Endpoint Calls Verified**: 97
- **Violations Found**: 0

## Verification Status
✅ **PASS**: Every button, link, form, and API integration has a real, working, verified target or behavior. No dead controls exist.

## Per-File Controls Breakdown

### `client/src/App.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `navigate(-1)}           classN` | ✅ PASS |
| Link | `/dashboard` | ✅ PASS |

### `client/src/auth-context.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| API Call | `/auth/me` | ✅ PASS |
| API Call | `/auth/logout` | ✅ PASS |

### `client/src/components/ErrorBoundary.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `Reload Page` | ✅ PASS |
| Button | `Return to Dashboard` | ✅ PASS |

### `client/src/components/Layout.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `setMenuOpen((v) => !v)}       ` | ✅ PASS |
| Button | `navigate('/notifications')}   ` | ✅ PASS |
| Button | `setProfileOpen((v) => !v)}    ` | ✅ PASS |
| Button | `{signingOut ? 'Signing out…' :` | ✅ PASS |
| Button | `setMenuOpen(false)}           ` | ✅ PASS |
| Button | `<span>🚪</span>               ` | ✅ PASS |
| Link | `/settings` | ✅ PASS |
| Link | `/settings` | ✅ PASS |
| Link | `/settings` | ✅ PASS |
| Link | `/dashboard` | ✅ PASS |
| Link | `/food-distribution` | ✅ PASS |
| Link | `/end-of-day-report` | ✅ PASS |
| Link | `/waste-analysis` | ✅ PASS |
| Link | `/reports` | ✅ PASS |
| Link | `/menu-management` | ✅ PASS |
| Link | `/settings` | ✅ PASS |
| Link | `/demo-guide` | ✅ PASS |
| Link | `/flow` | ✅ PASS |
| Link | `/memory` | ✅ PASS |
| Link | `/audit` | ✅ PASS |
| API Call | `/notifications/unread-count` | ✅ PASS |

### `client/src/pages/Analytics.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `void load()} disabled={loading` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/analytics/overview` | ✅ PASS |

### `client/src/pages/AuditLog.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{loading ? 'Refreshing…' : 'Re` | ✅ PASS |
| Button | `Apply Filters` | ✅ PASS |
| Button | `Reset` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/admin/audit-log` | ✅ PASS |
| API Call | `/admin/audit-log` | ✅ PASS |

### `client/src/pages/AuthExtras.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{busy ? 'Sending…' : 'Request ` | ✅ PASS |
| Button | `{busy ? 'Updating…' : 'Update ` | ✅ PASS |
| Button | `{busy ? 'Verifying…' : 'Verify` | ✅ PASS |
| Link | `/reset` | ✅ PASS |
| Link | `/login` | ✅ PASS |
| Link | `/login` | ✅ PASS |
| Link | `/login` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/auth/forgot` | ✅ PASS |
| API Call | `/auth/reset` | ✅ PASS |
| API Call | `/auth/verify` | ✅ PASS |

### `client/src/pages/Dashboard.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{genBusy ? 'Generating…' : '⚡ ` | ✅ PASS |
| Button | `{                 setTargetMod` | ✅ PASS |
| Button | `{                 setRecordMod` | ✅ PASS |
| Button | `setWhy(t)}                    ` | ✅ PASS |
| Button | `{                             ` | ✅ PASS |
| Button | `void onAdjust(adjId)}         ` | ✅ PASS |
| Button | `{bufBusy ? 'Saving…' : 'Save B` | ✅ PASS |
| Button | `setTargetModalOpen(false)}    ` | ✅ PASS |
| Button | `setTargetModalOpen(false)}    ` | ✅ PASS |
| Button | `{targetModalBusy ? 'Saving Tar` | ✅ PASS |
| Button | `setRecordModalOpen(false)}    ` | ✅ PASS |
| Button | `setRecordModalOpen(false)}    ` | ✅ PASS |
| Button | `{recordModalBusy ? 'Saving Rec` | ✅ PASS |
| Button | `Close (Esc)` | ✅ PASS |
| Link | `/setup` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/dashboard/overview` | ✅ PASS |
| API Call | `/flow/today` | ✅ PASS |
| API Call | `/targets/generate` | ✅ PASS |
| API Call | `/targets/buffer` | ✅ PASS |
| API Call | `/targets/` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/targets/quick-target` | ✅ PASS |
| API Call | `/food-records` | ✅ PASS |

### `client/src/pages/DigitalMemory.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{ setKitchen(''); setFood('');` | ✅ PASS |
| Button | `{rBusy ? 'Refreshing…' : 'Refr` | ✅ PASS |
| API Call | `/memory/summary` | ✅ PASS |
| API Call | `/memory/forecast` | ✅ PASS |
| API Call | `/memory/snapshots` | ✅ PASS |
| API Call | `/memory/refresh` | ✅ PASS |

### `client/src/pages/Eligibility.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{fBusy ? 'Assessing…' : 'Submi` | ✅ PASS |
| Button | `{cBusy ? 'Saving…' : 'Save'}` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/eligibility/assessments` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/eligibility/config` | ✅ PASS |
| API Call | `/eligibility/assess` | ✅ PASS |
| API Call | `/eligibility/config` | ✅ PASS |

### `client/src/pages/EndOfDay.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{loading ? 'Loading…' : 'Revie` | ✅ PASS |
| Button | `{busy ? 'Closing…' : 'Close da` | ✅ PASS |
| Button | `{ setReopenFor(true); setReope` | ✅ PASS |
| Button | `{reopenBusy ? 'Reopening…' : '` | ✅ PASS |
| Button | `setReopenFor(false)} className` | ✅ PASS |
| Link | `/food-data` | ✅ PASS |
| API Call | `/eod/reports` | ✅ PASS |
| API Call | `/eod/preview` | ✅ PASS |
| API Call | `/eod/close` | ✅ PASS |
| API Call | `/eod/preview` | ✅ PASS |
| API Call | `/eod/reopen` | ✅ PASS |

### `client/src/pages/Flow.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{saving ? 'Saving…' : 'Save en` | ✅ PASS |
| Button | `setOpenAction(openAction?.key ` | ✅ PASS |
| Button | `void submitAction(rk)} disable` | ✅ PASS |
| Button | `{tBusy ? 'Saving…' : 'Save ban` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/flow/entries` | ✅ PASS |
| API Call | `/flow/today` | ✅ PASS |
| API Call | `/flow/risk` | ✅ PASS |
| API Call | `/risk-thresholds` | ✅ PASS |
| API Call | `/flow/entries` | ✅ PASS |
| API Call | `/flow/actions/adjust-production` | ✅ PASS |
| API Call | `/flow/actions/special-offer` | ✅ PASS |
| API Call | `/flow/actions/prepare-redistribution` | ✅ PASS |
| API Call | `/risk-thresholds` | ✅ PASS |

### `client/src/pages/FoodData.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{fBusy ? 'Saving…' : editingId` | ✅ PASS |
| Button | `Cancel edit` | ✅ PASS |
| Button | `void load()} className="rounde` | ✅ PASS |
| Button | `startEdit(r)} className="round` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/food-records` | ✅ PASS |
| API Call | `/food-records/` | ✅ PASS |
| API Call | `/food-records` | ✅ PASS |

### `client/src/pages/Imports.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{busy ? 'Reading…' : 'Upload &` | ✅ PASS |
| Button | `{busy ? 'Importing…' : 'Confir` | ✅ PASS |
| Button | `openJob(result.job.id)} classN` | ✅ PASS |
| Button | `downloadErrorCsv(result.job.id` | ✅ PASS |
| Button | `void loadJobs()} className="ro` | ✅ PASS |
| Button | `openJob(j.id)} className="roun` | ✅ PASS |
| Button | `downloadErrorCsv(j.id)} classN` | ✅ PASS |
| API Call | `/imports/jobs` | ✅ PASS |
| API Call | `/imports/jobs/` | ✅ PASS |

### `client/src/pages/Inventory.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{ resetForm(); setShowForm((v)` | ✅ PASS |
| Button | `{cBusy ? 'Working…' : 'Confirm` | ✅ PASS |
| Button | `setConfirm(null)} disabled={cB` | ✅ PASS |
| Button | `{fBusy ? 'Saving…' : editing ?` | ✅ PASS |
| Button | `startEdit(l)} className="round` | ✅ PASS |
| Button | `{ setAdjId(adjId === l.id ? nu` | ✅ PASS |
| Button | `setConfirm({ action: 'archive'` | ✅ PASS |
| Button | `setConfirm({ action: 'restore'` | ✅ PASS |
| Button | `void runAdjust(l.id)} disabled` | ✅ PASS |
| Button | `{tBusy ? 'Saving…' : 'Save'}` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/inventory` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/inventory/alerts` | ✅ PASS |
| API Call | `/inventory/` | ✅ PASS |
| API Call | `/inventory` | ✅ PASS |
| API Call | `/inventory/` | ✅ PASS |
| API Call | `/inventory/` | ✅ PASS |
| API Call | `/inventory/thresholds` | ✅ PASS |

### `client/src/pages/Login.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{busy ? (               <>    ` | ✅ PASS |
| Link | `/forgot` | ✅ PASS |
| Link | `/signup` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/auth/login` | ✅ PASS |
| API Call | `/auth/me` | ✅ PASS |

### `client/src/pages/MenuPage.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{cBusy ? 'Working…' : 'Confirm` | ✅ PASS |
| Button | `setConfirm(null)} disabled={cB` | ✅ PASS |
| Button | `{ resetFoodForm(); setShowForm` | ✅ PASS |
| Button | `{fBusy ? 'Saving…' : editingId` | ✅ PASS |
| Button | `startEdit(i)} className="round` | ✅ PASS |
| Button | `setConfirm({ action: 'archive'` | ✅ PASS |
| Button | `setConfirm({ action: 'restore'` | ✅ PASS |
| Button | `setConfirm({ action: 'delete',` | ✅ PASS |
| Button | `{ resetMenuForm(); setShowMenu` | ✅ PASS |
| Button | `setMLines((ls) => ls.filter((_` | ✅ PASS |
| Button | `setMLines((ls) => [...ls, { fo` | ✅ PASS |
| Button | `{mBusy ? 'Saving…' : mEditing ` | ✅ PASS |
| Button | `startMenuEdit(m)} className="r` | ✅ PASS |
| Button | `setConfirm({ action: 'deleteMe` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/menus` | ✅ PASS |
| API Call | `/food-items/` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/menus/` | ✅ PASS |
| API Call | `/food-items/` | ✅ PASS |
| API Call | `/food-items/` | ✅ PASS |
| API Call | `/menus/` | ✅ PASS |
| API Call | `/menus` | ✅ PASS |

### `client/src/pages/NgoRegistry.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{busy ? 'Saving…' : editingId ` | ✅ PASS |
| Button | `{ setEditingId(null); setForm(` | ✅ PASS |
| Button | `startEdit(n)} className="round` | ✅ PASS |
| Button | `void setActive(n.id, false)} c` | ✅ PASS |
| Button | `void setActive(n.id, true)} cl` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/ngos` | ✅ PASS |
| API Call | `/ngos/` | ✅ PASS |
| API Call | `/ngos` | ✅ PASS |
| API Call | `/ngos/` | ✅ PASS |

### `client/src/pages/Notifications.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `setShowUnreadOnly((v) => !v)} ` | ✅ PASS |
| Button | `void load()} className="rounde` | ✅ PASS |
| Button | `void setRead(n.id, !n.isRead)}` | ✅ PASS |
| API Call | `/notifications` | ✅ PASS |
| API Call | `/notifications/` | ✅ PASS |

### `client/src/pages/Onboarding.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `navigate('/', { replace: true ` | ✅ PASS |
| Button | `setKitchens((ks) => [...ks, { ` | ✅ PASS |
| Button | `setKitchens((ks) => ks.filter(` | ✅ PASS |
| Button | `{busy ? 'Saving…' : 'Complete ` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/organizations/onboarding` | ✅ PASS |

### `client/src/pages/Organization.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{busy ? 'Saving…' : 'Save chan` | ✅ PASS |
| Button | `{kBusy ? 'Adding…' : 'Add unit` | ✅ PASS |
| Form | `form` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/organizations/mine` | ✅ PASS |
| API Call | `/organizations/kitchens` | ✅ PASS |

### `client/src/pages/Redistribution.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `void runNotify()} disabled={bu` | ✅ PASS |
| Button | `{ const m = matches[0]; if (m)` | ✅ PASS |
| Button | `void transition(r.id, 'schedul` | ✅ PASS |
| Button | `void transition(r.id, 'handove` | ✅ PASS |
| Button | `void transition(r.id, 'cancel'` | ✅ PASS |
| Button | `setHistory((h) => !h)} classNa` | ✅ PASS |
| Button | `void act(o.id, 'accept', { int` | ✅ PASS |
| Button | `void act(o.id, 'decline', { re` | ✅ PASS |
| Button | `void act(o.id, 'callback', { m` | ✅ PASS |
| Button | `void act(o.id, 'confirm-receip` | ✅ PASS |
| Link | `/eligibility` | ✅ PASS |
| Link | `/eligibility` | ✅ PASS |
| API Call | `/eligibility/assessments` | ✅ PASS |
| API Call | `/redistribution/records` | ✅ PASS |
| API Call | `/redistribution/matches` | ✅ PASS |
| API Call | `/redistribution/notify` | ✅ PASS |
| API Call | `/redistribution/` | ✅ PASS |
| API Call | `/redistribution/notify/` | ✅ PASS |
| API Call | `/redistribution/opportunities` | ✅ PASS |
| API Call | `/redistribution/` | ✅ PASS |

### `client/src/pages/Reports.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `void loadReport()} disabled={l` | ✅ PASS |
| Button | `void download(ext)} disabled={` | ✅ PASS |
| Button | `void saveSnapshot()} disabled=` | ✅ PASS |
| Button | `{fBusy ? 'Saving…' : 'Save fac` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/impact/factors` | ✅ PASS |
| API Call | `/impact/snapshots` | ✅ PASS |
| API Call | `/reports/data` | ✅ PASS |
| API Call | `/impact/factors` | ✅ PASS |
| API Call | `/impact/snapshots` | ✅ PASS |

### `client/src/pages/SetupPage.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{                       if (s ` | ✅ PASS |
| Button | `+ Add Item` | ✅ PASS |
| Button | `removeMenuItem(item.id)}      ` | ✅ PASS |
| Button | `setHistoricalOption('UPLOAD')}` | ✅ PASS |
| Button | `setHistoricalOption('MANUAL')}` | ✅ PASS |
| Button | `+ Add Record Row` | ✅ PASS |
| Button | `removeManualRow(r.id)}        ` | ✅ PASS |
| Button | `← Back` | ✅ PASS |
| Button | `Save &amp; Continue →` | ✅ PASS |
| Button | `{busy ? (                     ` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |
| API Call | `/menus` | ✅ PASS |
| API Call | `/food-records` | ✅ PASS |

### `client/src/pages/Signup.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{busy ? (               <>    ` | ✅ PASS |
| Link | `/login` | ✅ PASS |
| Form | `form` | ✅ PASS |
| API Call | `/auth/signup` | ✅ PASS |
| API Call | `/auth/login` | ✅ PASS |

### `client/src/pages/Waste.tsx`
| Element Type | Label / Target | Status |
| --- | --- | --- |
| Button | `{loading ? 'Analyzing…' : 'Ana` | ✅ PASS |
| API Call | `/food-items` | ✅ PASS |

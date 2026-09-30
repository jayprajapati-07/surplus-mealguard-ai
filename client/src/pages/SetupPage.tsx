import { useState, type FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API_BASE, getToken } from '../api';
import { useAuth } from '../auth-context';

export const INSTITUTION_OPTIONS = [
  { id: 'COLLEGE_CANTEEN', label: 'College Canteen', desc: 'Higher education cafeterias and dining halls' },
  { id: 'HOSTEL_MESS', label: 'Hostel / Mess', desc: 'Residential student messes and recurring dining' },
  { id: 'HOTEL_RESTAURANT', label: 'Hotel / Restaurant', desc: 'Hospitality kitchens and commercial dining' },
  { id: 'HOSPITAL_CAFETERIA', label: 'Hospital / Cafeteria', desc: 'Healthcare food services and dietetics' },
  { id: 'FOOD_PROCESSING_UNIT', label: 'Food Processing Unit', desc: 'Central preparation facilities and catering hubs' },
] as const;

interface MenuItemInput {
  id: string;
  name: string;
  mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'ANY';
  servingSizeKg: number;
  category: string;
}

interface ManualRecordInput {
  id: string;
  date: string;
  foodName: string;
  mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER';
  producedKg: number;
  servedKg: number;
  wasteKg: number;
}

export function SetupPage() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Organization details
  const [institutionType, setInstitutionType] = useState<string>('COLLEGE_CANTEEN');
  const [sector, setSector] = useState<'PRIVATE' | 'GOVERNMENT'>('PRIVATE');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [contactName, setContactName] = useState(user?.name ?? '');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState(user?.email ?? '');

  // Step 2: Kitchen Capacity & Hours
  const [capacityKg, setCapacityKg] = useState('1000');
  const [peopleServed, setPeopleServed] = useState('800');
  const [staffCount, setStaffCount] = useState('');
  const [openingTime, setOpeningTime] = useState('07:00 AM');
  const [closingTime, setClosingTime] = useState('09:00 PM');
  const [breakfastTiming, setBreakfastTiming] = useState('07:30 - 10:00 AM');
  const [lunchTiming, setLunchTiming] = useState('12:30 - 02:30 PM');
  const [dinnerTiming, setDinnerTiming] = useState('07:30 - 09:30 PM');

  // Step 3: Menu items
  const [menuItems, setMenuItems] = useState<MenuItemInput[]>([
    { id: '1', name: 'Steamed Basmati Rice', mealType: 'LUNCH', servingSizeKg: 0.25, category: 'Grains' },
    { id: '2', name: 'Toor Dal Tadka', mealType: 'LUNCH', servingSizeKg: 0.2, category: 'Lentils' },
    { id: '3', name: 'Wheat Chapati', mealType: 'DINNER', servingSizeKg: 0.15, category: 'Breads' },
    { id: '4', name: 'Mixed Seasonal Sabzi', mealType: 'LUNCH', servingSizeKg: 0.2, category: 'Vegetables' },
  ]);
  const [newFoodName, setNewFoodName] = useState('');
  const [newFoodMeal, setNewFoodMeal] = useState<'BREAKFAST' | 'LUNCH' | 'DINNER' | 'ANY'>('LUNCH');
  const [newFoodPortion, setNewFoodPortion] = useState('0.25');
  const [newFoodCategory, setNewFoodCategory] = useState('General');

  // Step 4: Historical Data
  const [historicalOption, setHistoricalOption] = useState<'UPLOAD' | 'MANUAL'>('UPLOAD');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewError, setPreviewError] = useState('');
  const [manualRecords, setManualRecords] = useState<ManualRecordInput[]>([
    {
      id: 'm1',
      date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      foodName: 'Steamed Basmati Rice',
      mealType: 'LUNCH',
      producedKg: 50,
      servedKg: 45,
      wasteKg: 3,
    },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (user?.name && !contactName) setContactName(user.name);
    if (user?.email && !contactEmail) setContactEmail(user.email);
  }, [user, contactName, contactEmail]);

  // Menu item helpers
  function addMenuItem() {
    if (!newFoodName.trim()) return;
    const item: MenuItemInput = {
      id: String(Date.now()),
      name: newFoodName.trim(),
      mealType: newFoodMeal,
      servingSizeKg: Number(newFoodPortion) || 0.25,
      category: newFoodCategory.trim() || 'General',
    };
    setMenuItems((prev) => [...prev, item]);
    setNewFoodName('');
  }

  function removeMenuItem(id: string) {
    setMenuItems((prev) => prev.filter((i) => i.id !== id));
  }

  // Manual records helpers
  function addManualRow() {
    const r: ManualRecordInput = {
      id: String(Date.now()),
      date: new Date().toISOString().slice(0, 10),
      foodName: menuItems[0]?.name || 'Rice',
      mealType: 'LUNCH',
      producedKg: 40,
      servedKg: 35,
      wasteKg: 2,
    };
    setManualRecords((prev) => [...prev, r]);
  }

  function updateManualRow(id: string, patch: Partial<ManualRecordInput>) {
    setManualRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeManualRow(id: string) {
    setManualRecords((prev) => prev.filter((r) => r.id !== id));
  }

  // File Upload Parser Preview
  async function handleFileSelected(selectedFile: File) {
    setFile(selectedFile);
    setPreviewError('');
    setUploadProgress(20);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      setUploadProgress(50);
      const token = getToken() ?? localStorage.getItem('mg_token') ?? '';
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let res = await fetch(`${API_BASE}/imports/parse`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (res.status === 404) {
        const retryFormData = new FormData();
        retryFormData.append('file', selectedFile);
        res = await fetch(`${API_BASE}/imports/preview`, {
          method: 'POST',
          headers,
          body: retryFormData,
        });
      }

      setUploadProgress(90);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to parse file preview.');
      }
      const data = await res.json();
      const rows = (data.previewRows || data.preview || []) as Array<Record<string, unknown>>;
      setPreviewRows(rows);
      setUploadProgress(100);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Could not parse data file.');
      setUploadProgress(0);
    }
  }

  function validateStep(s: number): string | null {
    if (s === 1) {
      if (name.trim().length < 2) return 'Please enter an organization name (min 2 characters).';
      if (address.trim().length < 5) return 'Please enter full address (min 5 characters).';
      if (city.trim().length < 2) return 'Please enter city / location.';
      if (contactName.trim().length < 2) return 'Please enter contact person name.';
      if (contactPhone.trim().length < 7) return 'Please enter a valid contact phone number.';
      if (!/^\S+@\S+\.\S+$/.test(contactEmail.trim())) return 'Please enter a valid email address.';
    }
    if (s === 2) {
      const cap = Number(capacityKg);
      if (!Number.isFinite(cap) || cap <= 0) return 'Kitchen daily capacity must be a positive number (kg/servings).';
      const ps = Number(peopleServed);
      if (!Number.isInteger(ps) || ps < 1) return 'Expected daily servings must be at least 1.';
    }
    if (s === 3) {
      if (menuItems.length < 1) return 'Please add at least one menu item.';
    }
    return null;
  }

  function goNext() {
    setError('');
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    if (step < 4) setStep((s) => (s + 1) as 1 | 2 | 3 | 4);
  }

  function goBack() {
    setError('');
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
  }

  async function handleCompleteSetup(e: FormEvent) {
    e.preventDefault();
    setError('');
    for (let s = 1; s <= 3; s++) {
      const p = validateStep(s);
      if (p) {
        setError(p);
        setStep(s as 1 | 2 | 3 | 4);
        return;
      }
    }

    setBusy(true);
    try {
      // 1. Create Organization & Main Kitchen Unit
      const operatingHoursString = `${openingTime} - ${closingTime} (Meals: B: ${breakfastTiming}, L: ${lunchTiming}, D: ${dinnerTiming})`;
      const onboardingPayload = {
        sector,
        institutionType,
        name: name.trim(),
        address: address.trim(),
        city: city.trim(),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim().toLowerCase(),
        operatingHours: operatingHoursString,
        peopleServedDaily: Number(peopleServed) || 500,
        kitchenCapacityKg: Number(capacityKg) || 1000,
        kitchens: [
          {
            name: 'Main Production Kitchen',
            mealTimings: `Breakfast: ${breakfastTiming}, Lunch: ${lunchTiming}, Dinner: ${dinnerTiming}`,
            storageAreas: 'Cold Storage, Dry Pantry, Hot Holding',
            foodCategories: menuItems.map((m) => m.category).slice(0, 5).join(', ') || 'Grains, Curries, Breads',
            productionCapacityKg: Number(capacityKg) || 1000,
          },
        ],
      };

      const orgRes = await api<{ organization: { id: string; kitchens: Array<{ id: string }> } }>(
        '/organizations/onboarding',
        {
          method: 'POST',
          body: JSON.stringify(onboardingPayload),
        }
      );

      const kitchenId = orgRes.organization.kitchens[0]?.id;

      // 2. Persist Menu Items
      const createdFoodItemIds: Record<string, string> = {};
      for (const item of menuItems) {
        try {
          const foodRes = await api<{ item: { id: string } }>('/food-items', {
            method: 'POST',
            body: JSON.stringify({
              name: item.name,
              category: item.category,
              mealType: item.mealType,
              standardPortionKg: item.servingSizeKg,
              unit: 'kg',
            }),
          });
          createdFoodItemIds[item.name] = foodRes.item.id;
        } catch {
          // ignore duplicate names if seed exists
        }
      }

      // 3. Create active initial Menu
      const initialItems = Object.entries(createdFoodItemIds).map(([, id]) => ({
        foodItemId: id,
        quantityKg: 25,
      }));

      if (initialItems.length > 0 && kitchenId) {
        try {
          await api('/menus', {
            method: 'POST',
            body: JSON.stringify({
              kitchenUnitId: kitchenId,
              date: new Date().toISOString().slice(0, 10),
              mealType: 'LUNCH',
              title: "Today's Core Production Menu",
              scope: 'DAILY',
              items: initialItems,
            }),
          });
        } catch {
          // continue gracefully
        }
      }

      // 4. Save Historical Data if provided
      if (historicalOption === 'MANUAL' && manualRecords.length > 0 && kitchenId) {
        for (const rec of manualRecords) {
          const foodId = createdFoodItemIds[rec.foodName] || undefined;
          if (foodId) {
            try {
              await api('/food-records', {
                method: 'POST',
                body: JSON.stringify({
                  date: rec.date,
                  kitchenUnitId: kitchenId,
                  foodItemId: foodId,
                  mealType: rec.mealType,
                  producedKg: rec.producedKg,
                  soldKg: rec.servedKg,
                  wasteKg: rec.wasteKg,
                  remainingKg: Math.max(0, rec.producedKg - rec.servedKg - rec.wasteKg),
                }),
              });
            } catch {
              // continue
            }
          }
        }
      } else if (historicalOption === 'UPLOAD' && file && kitchenId) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('kitchenUnitId', kitchenId);
        try {
          const token = getToken() ?? localStorage.getItem('mg_token') ?? '';
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          let impRes = await fetch(`${API_BASE}/imports/confirm`, {
            method: 'POST',
            headers,
            body: formData,
          });
          if (impRes.status === 404) {
            const retryFormData = new FormData();
            retryFormData.append('file', file);
            retryFormData.append('kitchenUnitId', kitchenId);
            await fetch(`${API_BASE}/imports/execute`, {
              method: 'POST',
              headers,
              body: retryFormData,
            });
          }
        } catch {
          // non-blocking
        }
      }

      // 5. Refresh Auth Session to update user.organizationId
      await refresh();
      setSuccess(true);

      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete setup. Please check your details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] py-10 px-4 sm:px-6">
      {/* Standalone Setup Container - Strictly NO SIDEBAR, NO APP SHELL */}
      <div className="mx-auto max-w-4xl">
        {/* Top Branding Banner */}
        <div className="mb-6 flex items-center justify-between border-b border-stone-200 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#0B1F33] text-xl text-white shadow-sm">
              🌿
            </span>
            <div>
              <p className="text-base font-bold tracking-tight text-[#0B1F33]">Surplus MealGuard AI</p>
              <p className="text-xs text-stone-500">Intelligent Institutional Food Flow</p>
            </div>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#1565C0]">
            Onboarding Setup
          </span>
        </div>

        {/* Card Frame */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-10">
          {/* Header */}
          <div className="border-b border-stone-100 pb-6 text-center">
            <h1 className="text-2xl font-extrabold tracking-tight text-[#0B1F33] sm:text-3xl">
              Complete Your Organization Setup
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm text-stone-600">
              Tell us about your organization so Surplus MealGuard AI can personalize food production and waste analysis.
            </p>

            {/* Stepper Indicator */}
            <div className="mt-8 flex items-center justify-center gap-2 sm:gap-4">
              {[
                { s: 1, label: 'Organization Details' },
                { s: 2, label: 'Kitchen & Hours' },
                { s: 3, label: 'Menu Setup' },
                { s: 4, label: 'Historical Data' },
              ].map(({ s, label }, idx) => (
                <div key={s} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (s < step) setStep(s as 1 | 2 | 3 | 4);
                    }}
                    className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                      step === s
                        ? 'bg-[#0B1F33] text-white shadow-sm font-bold'
                        : step > s
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'text-stone-400 bg-stone-50'
                    }`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px]">
                      {step > s ? '✓' : s}
                    </span>
                    <span className="hidden md:inline">{label}</span>
                  </button>
                  {idx < 3 && <span className="mx-1 text-stone-300">→</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Success Overlay / State */}
          {success ? (
            <div className="py-16 text-center" role="status">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
                ✓
              </div>
              <h2 className="mt-4 text-2xl font-bold text-stone-900">Account Setup Complete</h2>
              <p className="mt-2 text-stone-600">Your organization profile is ready.</p>
              <div className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-[#1565C0]">
                <span className="animate-spin">⏳</span> Redirecting to Main Dashboard...
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => e.preventDefault()} className="mt-8 space-y-6">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                  <strong>Validation error:</strong> {error}
                </div>
              )}

              {/* STEP 1: ORGANIZATION TYPE & DETAILS */}
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-stone-800">
                      1. Select Organization Type <span className="text-red-600">*</span>
                    </label>
                    <p className="text-xs text-stone-500 mb-3">Choose the category that best represents your facility.</p>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {INSTITUTION_OPTIONS.map((opt) => (
                        <div
                          key={opt.id}
                          onClick={() => setInstitutionType(opt.id)}
                          className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                            institutionType === opt.id
                              ? 'border-[#1565C0] bg-blue-50/50 shadow-sm ring-2 ring-[#1565C0]/20'
                              : 'border-stone-200 hover:border-stone-300 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className="font-semibold text-sm text-stone-900">{opt.label}</p>
                            <input
                              type="radio"
                              name="institutionType"
                              checked={institutionType === opt.id}
                              onChange={() => setInstitutionType(opt.id)}
                              className="text-[#1565C0]"
                            />
                          </div>
                          <p className="mt-1 text-xs text-stone-500">{opt.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-stone-100 pt-5">
                    <label className="block text-sm font-bold text-stone-800 mb-3">
                      2. Organization Details <span className="text-red-600">*</span>
                    </label>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-stone-700">Organization Name</label>
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g. Pune Central Engineering College Canteen"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:border-[#1565C0] focus:ring-1 focus:ring-[#1565C0]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Sector</label>
                        <select
                          value={sector}
                          onChange={(e) => setSector(e.target.value as 'PRIVATE' | 'GOVERNMENT')}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        >
                          <option value="PRIVATE">Private Institution</option>
                          <option value="GOVERNMENT">Government / Aided Facility</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">City / Service Area</label>
                        <input
                          type="text"
                          required
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="e.g. Pune"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-stone-700">Area / Location (Address)</label>
                        <input
                          type="text"
                          required
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder="e.g. Sector 4, University Campus Avenue, Shivajinagar"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Contact Person Name</label>
                        <input
                          type="text"
                          required
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder="e.g. Raj Sharma"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Contact Phone</label>
                        <input
                          type="tel"
                          required
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="e.g. +91 98765 43210"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-stone-700">Contact Email</label>
                        <input
                          type="email"
                          required
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="admin@institution.edu"
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: KITCHEN CAPACITY & HOURS */}
              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-sm font-bold text-stone-800">Kitchen Capacity Parameters</h2>
                    <p className="text-xs text-stone-500 mb-3">
                      Defines production thresholds and safety margins for baseline AI calculations.
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Max Daily Capacity (kg/servings)</label>
                        <input
                          type="number"
                          min="10"
                          value={capacityKg}
                          onChange={(e) => setCapacityKg(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                          placeholder="1000"
                        />
                        <span className="text-[11px] text-stone-400">e.g. 1000 servings/day</span>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Expected Daily Servings</label>
                        <input
                          type="number"
                          min="1"
                          value={peopleServed}
                          onChange={(e) => setPeopleServed(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                          placeholder="800"
                        />
                        <span className="text-[11px] text-stone-400">Headcount expected</span>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Kitchen Staff Count (Optional)</label>
                        <input
                          type="number"
                          min="1"
                          value={staffCount}
                          onChange={(e) => setStaffCount(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                          placeholder="12"
                        />
                        <span className="text-[11px] text-stone-400">Staff on duty</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-stone-100 pt-5">
                    <h2 className="text-sm font-bold text-stone-800">Operation Hours &amp; Meal Shifts</h2>
                    <p className="text-xs text-stone-500 mb-3">Establishes daily prep windows and cutoff times.</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Opening Time</label>
                        <input
                          type="text"
                          value={openingTime}
                          onChange={(e) => setOpeningTime(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                          placeholder="07:00 AM"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Closing Time</label>
                        <input
                          type="text"
                          value={closingTime}
                          onChange={(e) => setClosingTime(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                          placeholder="09:00 PM"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Breakfast Window</label>
                        <input
                          type="text"
                          value={breakfastTiming}
                          onChange={(e) => setBreakfastTiming(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-stone-700">Lunch Window</label>
                        <input
                          type="text"
                          value={lunchTiming}
                          onChange={(e) => setLunchTiming(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-stone-700">Dinner Window</label>
                        <input
                          type="text"
                          value={dinnerTiming}
                          onChange={(e) => setDinnerTiming(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: MENU ITEMS */}
              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-sm font-bold text-stone-800">Core Menu Configuration</h2>
                    <p className="text-xs text-stone-500 mb-3">
                      Add standard food items produced in your kitchen. These items power production targets and flow logging.
                    </p>

                    {/* Add Item Row */}
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                      <p className="text-xs font-bold text-stone-700 mb-2">+ Add Menu Item</p>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
                        <input
                          type="text"
                          placeholder="Food Name (e.g. Steamed Rice)"
                          value={newFoodName}
                          onChange={(e) => setNewFoodName(e.target.value)}
                          className="rounded-xl border border-stone-300 px-3 py-2 text-xs bg-white"
                        />
                        <select
                          value={newFoodMeal}
                          onChange={(e) => setNewFoodMeal(e.target.value as 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'ANY')}
                          className="rounded-xl border border-stone-300 px-3 py-2 text-xs bg-white"
                        >
                          <option value="BREAKFAST">Breakfast</option>
                          <option value="LUNCH">Lunch</option>
                          <option value="DINNER">Dinner</option>
                          <option value="ANY">All Day</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Category (e.g. Grains)"
                          value={newFoodCategory}
                          onChange={(e) => setNewFoodCategory(e.target.value)}
                          className="rounded-xl border border-stone-300 px-3 py-2 text-xs bg-white"
                        />
                        <button
                          type="button"
                          onClick={addMenuItem}
                          className="rounded-xl bg-[#1565C0] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                        >
                          + Add Item
                        </button>
                      </div>
                    </div>

                    {/* Items List */}
                    <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-stone-200 bg-stone-50 font-semibold text-stone-700">
                          <tr>
                            <th className="px-4 py-2.5">Food Name</th>
                            <th className="px-4 py-2.5">Meal Type</th>
                            <th className="px-4 py-2.5">Category</th>
                            <th className="px-4 py-2.5">Portion Size</th>
                            <th className="px-4 py-2.5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {menuItems.map((item) => (
                            <tr key={item.id} className="hover:bg-stone-50">
                              <td className="px-4 py-2.5 font-medium text-stone-900">{item.name}</td>
                              <td className="px-4 py-2.5">
                                <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700">
                                  {item.mealType}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-stone-600">{item.category}</td>
                              <td className="px-4 py-2.5 text-stone-600">{item.servingSizeKg} kg/serving</td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeMenuItem(item.id)}
                                  className="text-red-600 hover:text-red-800 font-semibold text-xs"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: HISTORICAL DATA */}
              {step === 4 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-sm font-bold text-stone-800">Historical Consumption Data</h2>
                    <p className="text-xs text-stone-500 mb-4">
                      Feed past records to Surplus MealGuard AI so it can self-tune production targets and predict demand accurately.
                    </p>

                    {/* Mode Toggle */}
                    <div className="flex gap-2 border-b border-stone-200 pb-3">
                      <button
                        type="button"
                        onClick={() => setHistoricalOption('UPLOAD')}
                        className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                          historicalOption === 'UPLOAD'
                            ? 'bg-[#0B1F33] text-white shadow-sm'
                            : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        }`}
                      >
                        Option A: Upload CSV / Excel
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoricalOption('MANUAL')}
                        className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                          historicalOption === 'MANUAL'
                            ? 'bg-[#0B1F33] text-white shadow-sm'
                            : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        }`}
                      >
                        Option B: Manual Entry
                      </button>
                    </div>
                  </div>

                  {historicalOption === 'UPLOAD' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between rounded-xl bg-blue-50/60 p-3.5 border border-blue-100 text-xs">
                        <span className="text-blue-900 font-medium">
                          Need a pre-formatted file? Download our verified sample template:
                        </span>
                        <div className="flex gap-2">
                          <a
                            href={`${API_BASE}/imports/templates/csv`}
                            className="rounded-lg bg-white px-2.5 py-1 font-semibold text-[#1565C0] border border-blue-200 shadow-xs"
                            download
                          >
                            Sample CSV
                          </a>
                          <a
                            href={`${API_BASE}/imports/templates/xlsx`}
                            className="rounded-lg bg-white px-2.5 py-1 font-semibold text-[#1565C0] border border-blue-200 shadow-xs"
                            download
                          >
                            Sample XLSX
                          </a>
                        </div>
                      </div>

                      <div className="rounded-2xl border-2 border-dashed border-stone-300 p-8 text-center bg-stone-50/50 hover:bg-stone-50 transition-colors">
                        <span className="text-3xl">📁</span>
                        <p className="mt-2 text-sm font-semibold text-stone-800">
                          {file ? file.name : 'Upload historical food data (.csv, .xlsx, .xls)'}
                        </p>
                        <p className="text-xs text-stone-500 mt-1">Columns: Date, Food Item, Produced, Sold, Waste</p>
                        <label className="mt-4 inline-block cursor-pointer rounded-xl bg-[#1565C0] px-4 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700">
                          Choose File
                          <input
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleFileSelected(f);
                            }}
                          />
                        </label>
                      </div>

                      {uploadProgress > 0 && uploadProgress < 100 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-stone-600">
                            <span>Validating and parsing file...</span>
                            <span>{uploadProgress}%</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                            <div className="h-full bg-[#1565C0] transition-all" style={{ width: `${uploadProgress}%` }} />
                          </div>
                        </div>
                      )}

                      {previewError && (
                        <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">
                          {previewError}
                        </p>
                      )}

                      {previewRows.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-stone-700 mb-1.5">
                            Data Preview ({previewRows.length} sample rows parsed successfully):
                          </p>
                          <div className="max-h-44 overflow-auto rounded-xl border border-stone-200 bg-white">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-stone-50 border-b border-stone-200 text-stone-700">
                                <tr>
                                  {Object.keys(previewRows[0] || {}).slice(0, 5).map((col) => (
                                    <th key={col} className="px-3 py-2 font-semibold truncate">{col}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-100">
                                {previewRows.slice(0, 4).map((row, idx) => (
                                  <tr key={idx}>
                                    {Object.values(row).slice(0, 5).map((v, i) => (
                                      <td key={i} className="px-3 py-1.5 text-stone-600 truncate">{String(v ?? '')}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {historicalOption === 'MANUAL' && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <p className="text-xs font-semibold text-stone-700">Enter recent daily production and waste records:</p>
                        <button
                          type="button"
                          onClick={addManualRow}
                          className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                        >
                          + Add Record Row
                        </button>
                      </div>

                      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-stone-50 border-b border-stone-200 text-stone-700 font-semibold">
                            <tr>
                              <th className="px-3 py-2">Date</th>
                              <th className="px-3 py-2">Food Item</th>
                              <th className="px-3 py-2">Meal</th>
                              <th className="px-3 py-2">Produced (kg)</th>
                              <th className="px-3 py-2">Served (kg)</th>
                              <th className="px-3 py-2">Waste (kg)</th>
                              <th className="px-3 py-2 text-right">Remove</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {manualRecords.map((r) => (
                              <tr key={r.id}>
                                <td className="p-2">
                                  <input
                                    type="date"
                                    value={r.date}
                                    onChange={(e) => updateManualRow(r.id, { date: e.target.value })}
                                    className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={r.foodName}
                                    onChange={(e) => updateManualRow(r.id, { foodName: e.target.value })}
                                    className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="p-2">
                                  <select
                                    value={r.mealType}
                                    onChange={(e) =>
                                      updateManualRow(r.id, {
                                        mealType: e.target.value as 'BREAKFAST' | 'LUNCH' | 'DINNER',
                                      })
                                    }
                                    className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                                  >
                                    <option value="BREAKFAST">Breakfast</option>
                                    <option value="LUNCH">Lunch</option>
                                    <option value="DINNER">Dinner</option>
                                  </select>
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    min="0"
                                    value={r.producedKg}
                                    onChange={(e) => updateManualRow(r.id, { producedKg: Number(e.target.value) || 0 })}
                                    className="w-16 rounded-lg border border-stone-300 px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    min="0"
                                    value={r.servedKg}
                                    onChange={(e) => updateManualRow(r.id, { servedKg: Number(e.target.value) || 0 })}
                                    className="w-16 rounded-lg border border-stone-300 px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    min="0"
                                    value={r.wasteKg}
                                    onChange={(e) => updateManualRow(r.id, { wasteKg: Number(e.target.value) || 0 })}
                                    className="w-16 rounded-lg border border-stone-300 px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeManualRow(r.id)}
                                    className="text-red-600 hover:text-red-800 text-xs font-bold"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Buttons Bar */}
              <div className="flex items-center justify-between border-t border-stone-100 pt-6">
                <div>
                  {step > 1 ? (
                    <button
                      type="button"
                      onClick={goBack}
                      disabled={busy}
                      className="rounded-xl border border-stone-300 px-5 py-2.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                    >
                      ← Back
                    </button>
                  ) : (
                    <div />
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {step < 4 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      className="rounded-xl bg-[#0B1F33] px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-navy-800 transition-colors"
                    >
                      Save &amp; Continue →
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCompleteSetup}
                      disabled={busy}
                      className="rounded-xl bg-[#2E7D32] px-8 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-800 disabled:opacity-60 transition-all flex items-center gap-2"
                    >
                      {busy ? (
                        <>
                          <span className="animate-spin">⏳</span>
                          <span>Saving Organization Profile...</span>
                        </>
                      ) : (
                        <span>✓ COMPLETE SETUP</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

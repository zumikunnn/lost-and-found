
import { useEffect, useState } from "react";
import brandPhoto from "./assets/schoolLogo.jpg";
import { supabase } from "./supabase";
import "./App.css";

const CATEGORIES = [
  "Electronics",
  "ID / Cards",
  "Bags",
  "Clothing",
  "Books / School Supplies",
  "Keys",
  "Accessories",
  "Other",
];

const emptyReport = {
  title: "",
  description: "",
  category: "Other",
  report_type: "lost",
  location: "",
  item_date: new Date().toISOString().slice(0, 10),
};

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [items, setItems] = useState([]);
  const [claims, setClaims] = useState([]);
  const [page, setPage] = useState("browse");
  const [menuOpen, setMenuOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [report, setReport] = useState(emptyReport);
  const [photo, setPhoto] = useState(null);
  const [claimItem, setClaimItem] = useState(null);
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      setSession(data?.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setProfile(null);
      setItems([]);
      setClaims([]);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setItems([]);
      setClaims([]);
      return;
    }

    loadProfile();
    loadItems();
  }, [session]);

  useEffect(() => {
    if (profile?.role === "staff" || profile?.role === "admin") {
      loadClaims();
    }
  }, [profile]);

  async function loadProfile() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", session.user.id)
      .single();

    if (error) {
      setMessage("Could not load your campus profile: " + error.message);
      return;
    }

    setProfile(data);
  }

  async function loadItems() {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) setMessage(error.message);
    else setItems(data ?? []);
  }

  async function loadClaims() {
    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) setMessage(error.message);
    else setClaims(data ?? []);
  }

  async function authenticate(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (authMode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { full_name: fullName.trim() },
          },
        });

        if (error) throw error;

        setMessage(
          data.session
            ? "Account created. Check that your campus profile loads."
            : "Account created. Check your campus email to confirm registration."
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) throw error;
        setMessage("Signed in successfully.");
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(error.message);
    else {
      setPage("browse");
      setMessage("");
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!session) return;

    setBusy(true);
    setMessage("");

    try {
      let imagePath = null;

      if (photo) {
        if (photo.size > 5 * 1024 * 1024) {
          throw new Error("The image must be 5 MB or smaller.");
        }

        if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
          throw new Error("Use a JPG, PNG, or WebP image.");
        }

        const extension = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        }[photo.type];

        imagePath = `${session.user.id}/${crypto.randomUUID()}.${extension}`;

        const { error } = await supabase.storage
          .from("item-photos")
          .upload(imagePath, photo, {
            contentType: photo.type,
            upsert: false,
          });

        if (error) throw error;
      }

      const { error } = await supabase.from("items").insert({
        ...report,
        user_id: session.user.id,
        image_path: imagePath,
      });

      if (error) {
        if (imagePath) {
          await supabase.storage.from("item-photos").remove([imagePath]);
        }
        throw error;
      }

      setReport(emptyReport);
      setPhoto(null);
      setPage("browse");
      setMessage("Your report has been submitted.");
      await loadItems();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitClaim(event) {
    event.preventDefault();
    if (!claimItem || !session) return;

    setBusy(true);
    setMessage("");

    try {
      const { error } = await supabase.from("claims").insert({
        item_id: claimItem.id,
        claimant_id: session.user.id,
        proof: proof.trim(),
      });

      if (error) throw error;

      setClaimItem(null);
      setProof("");
      setMessage("Claim submitted for staff verification.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function reviewClaim(claim, status) {
    if (!profile || !["staff", "admin"].includes(profile.role)) return;

    const confirmed = window.confirm(
      status === "approved"
        ? "Approve this claim? Verify ownership before releasing the item."
        : "Reject this claim?"
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("claims")
        .update({
          status,
          reviewed_by: session.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", claim.id)
        .eq("status", "pending");

      if (error) throw error;

      if (status === "approved") {
        const { error: itemError } = await supabase
          .from("items")
          .update({ status: "returned" })
          .eq("id", claim.item_id);

        if (itemError) {
          throw new Error(
            "Claim was approved, but item status could not be updated. Contact the administrator."
          );
        }
      }

      setMessage(`Claim ${status}.`);
      await Promise.all([loadClaims(), loadItems()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function getPhotoUrl(path) {
    if (!path) return null;

    const { data, error } = await supabase.storage
      .from("item-photos")
      .createSignedUrl(path, 300);

    if (error) {
      console.error(error.message);
      return null;
    }

    return data.signedUrl;
  }

  const [photoUrls, setPhotoUrls] = useState({});

  useEffect(() => {
    let active = true;

    async function loadPhotos() {
      const paths = [...new Set(
        items.map((item) => item.image_path).filter(Boolean)
      )];

      const results = await Promise.all(
        paths.map(async (path) => [path, await getPhotoUrl(path)])
      );

      if (active) {
        setPhotoUrls((previous) => ({
          ...previous,
          ...Object.fromEntries(results.filter(([, url]) => url)),
        }));
      }
    }

    loadPhotos();
    return () => {
      active = false;
    };
  }, [items]);

  const visibleItems = items.filter((item) => {
    const text = `${item.title} ${item.description} ${item.location} ${item.category}`
      .toLowerCase();

    const matchesSearch = text.includes(search.toLowerCase());
    const matchesFilter = filter === "all" || item.report_type === filter;

    return matchesSearch && matchesFilter;
  });

  if (!session) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={authenticate}>
          <img className="brand-mark" src={brandPhoto} alt="CampusFind brand mark" />
          <p className="eyebrow">CAMPUS COMMUNITY</p>
          <h1>Lost something?</h1>
          <p className="muted">
            Find your belongings or help return something to its owner.
          </p>

          {authMode === "register" && (
            <label>
              Full name
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
          )}

          <label>
            Campus email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>

          <button className="primary full" disabled={busy}>
            {busy
              ? "Please wait..."
              : authMode === "login"
                ? "Sign in"
                : "Create campus account"}
          </button>

          <button
            type="button"
            className="text-button"
            onClick={() => {
              setAuthMode(authMode === "login" ? "register" : "login");
              setMessage("");
            }}
          >
            {authMode === "login"
              ? "New here? Create an account"
              : "Already registered? Sign in"}
          </button>

          {message && <p className="notice">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "menu-open" : ""}`}>
        <div className="brand">
          <img className="brand-mark" src={brandPhoto} alt="CampusFind brand mark" />
          <div className="brand-copy">
            <strong>CampusFind</strong>
            <small>Lost & Found</small>
          </div>
          <button
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>

        <div className={`sidebar-menu ${menuOpen ? "open" : ""}`}>
          <p className="nav-label">WORKSPACE</p>

          {[
          ["browse", "Browse items"],
          ["report", "Report an item"],
          ["my-items", "My reports"],
          ["my-claims", "My claims"],
          ...(["staff", "admin"].includes(profile?.role)
            ? [["review", "Claim review"]]
            : []),
          ].map(([key, label]) => (
            <button
              key={key}
              className={`nav-button ${page === key ? "active" : ""}`}
              onClick={() => {
                setPage(key);
                setMessage("");
                setMenuOpen(false);
              }}
            >
              {label}
            </button>
          ))}

          <div className="sidebar-bottom">
            <small>{profile?.full_name || session.user.email}</small>
            <small>{profile?.role || "Loading profile..."}</small>
            <button className="text-button" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">CAMPUS LOST & FOUND</p>
            <h1>
              {{
                browse: "Find your item",
                report: "Report an item",
                "my-items": "My reports",
                "my-claims": "My claims",
                review: "Review claims",
              }[page] || "CampusFind"}
            </h1>
          </div>

          <button
            className="primary"
            onClick={() => setPage("report")}
          >
            + Report item
          </button>
        </header>

        {message && (
          <div className="notice" role="status">
            {message}
            <button
              className="dismiss"
              onClick={() => setMessage("")}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        {page === "browse" && (
          <>
            <section className="welcome-panel">
              <p className="eyebrow">A LITTLE HELP GOES A LONG WAY</p>
              <h2>Lost it? Found it? Let's reunite it.</h2>
              <p>Search campus reports and help belongings find their owners.</p>
            </section>

            <div className="search-row">
              <input
                placeholder="Search item, category, or location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All reports</option>
                <option value="lost">Lost items</option>
                <option value="found">Found items</option>
              </select>
            </div>

            <div className="section-heading">
              <h2>Recent reports</h2>
              <span>{visibleItems.length} items</span>
            </div>

            <div className="item-grid">
              {visibleItems.map((item) => (
                <article className="item-card" key={item.id}>
                  {photoUrls[item.image_path] ? (
                    <img
                      className="item-photo"
                      src={photoUrls[item.image_path]}
                      alt={item.title}
                    />
                  ) : (
                    <div className="photo-placeholder">
                      {item.category}
                    </div>
                  )}

                  <div className="item-body">
                    <span className={`status-pill ${item.report_type}`}>
                      {item.report_type}
                    </span>

                    <h3>{item.title}</h3>
                    <p className="muted clamp">{item.description}</p>
                    <p className="item-meta">⌖ {item.location}</p>
                    <p className="item-meta">
                      {item.category} · {item.item_date}
                    </p>

                    {item.status !== "open" && (
                      <span className="muted">
                        Status: {item.status.replace("_", " ")}
                      </span>
                    )}

                    {item.status === "open" &&
                      item.user_id !== session.user.id && (
                        <button
                          className="primary full"
                          onClick={() => setClaimItem(item)}
                        >
                          Claim item
                        </button>
                      )}
                  </div>
                </article>
              ))}
            </div>

            {visibleItems.length === 0 && (
              <div className="empty-state">
                <h3>No matching items</h3>
                <p>Try another search or check back later.</p>
              </div>
            )}
          </>
        )}

        {page === "report" && (
          <form className="form-card" onSubmit={submitReport}>
            <h2>Tell us about the item</h2>
            <p className="muted">
              Include enough detail to help people recognize it.
            </p>

            <label>
              Report type
              <select
                value={report.report_type}
                onChange={(e) =>
                  setReport({ ...report, report_type: e.target.value })
                }
              >
                <option value="lost">I lost an item</option>
                <option value="found">I found an item</option>
              </select>
            </label>

            <label>
              Item name
              <input
                value={report.title}
                onChange={(e) =>
                  setReport({ ...report, title: e.target.value })
                }
                maxLength={100}
                required
                placeholder="e.g. Black wireless earbuds"
              />
            </label>

            <label>
              Category
              <select
                value={report.category}
                onChange={(e) =>
                  setReport({ ...report, category: e.target.value })
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>

            <label>
              Description
              <textarea
                value={report.description}
                onChange={(e) =>
                  setReport({ ...report, description: e.target.value })
                }
                minLength={5}
                maxLength={2000}
                required
                placeholder="Describe the item without revealing private identifying details."
              />
            </label>

            <label>
              Campus location
              <input
                value={report.location}
                onChange={(e) =>
                  setReport({ ...report, location: e.target.value })
                }
                required
                maxLength={200}
                placeholder="e.g. Library, second floor"
              />
            </label>

            <label>
              Date lost or found
              <input
                type="date"
                value={report.item_date}
                onChange={(e) =>
                  setReport({ ...report, item_date: e.target.value })
                }
                max={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>

            <label>
              Item photo (optional, maximum 5 MB)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setPhoto(e.target.files?.[0] || null)}
              />
            </label>

            <button className="primary" disabled={busy}>
              {busy ? "Submitting..." : "Submit report"}
            </button>
          </form>
        )}

        {page === "my-items" && (
          <div className="item-grid">
            {items.filter((i) => i.user_id === session.user.id).map((item) => (
              <article className="item-card item-body" key={item.id}>
                <span className={`status-pill ${item.report_type}`}>
                  {item.report_type}
                </span>
                <h3>{item.title}</h3>
                <p>{item.location}</p>
                <p className="muted">Status: {item.status.replace("_", " ")}</p>
              </article>
            ))}
          </div>
        )}

        {page === "my-claims" && <MyClaims session={session} />}

        {page === "review" && (
          <div className="form-card">
            <h2>Pending and reviewed claims</h2>
            {claims.length === 0 && <p>No claims found.</p>}

            {claims.map((claim) => (
              <article className="claim-row" key={claim.id}>
                <p><strong>Item:</strong> {items.find(
                  (item) => item.id === claim.item_id
                )?.title || claim.item_id}</p>
                <p><strong>Claimant ID:</strong> {claim.claimant_id}</p>
                <p><strong>Proof:</strong> {claim.proof}</p>
                <p><strong>Status:</strong> {claim.status}</p>

                {claim.status === "pending" && (
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => reviewClaim(claim, "approved")}
                    >
                      Approve
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => reviewClaim(claim, "rejected")}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>

      {claimItem && (
        <div className="modal-backdrop">
          <form className="modal-card" onSubmit={submitClaim}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setClaimItem(null)}
              aria-label="Close"
            >
              ×
            </button>

            <p className="eyebrow">OWNERSHIP VERIFICATION</p>
            <h2>Claim {claimItem.title}</h2>
            <p className="muted">
              Explain identifying details that help campus staff verify
              this item belongs to you. Do not include passwords or sensitive
              identity numbers.
            </p>

            <label>
              Proof of ownership
              <textarea
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                minLength={10}
                maxLength={1000}
                required
                placeholder="Describe a unique feature, contents, or another way to verify ownership."
              />
            </label>

            <button className="primary full" disabled={busy}>
              {busy ? "Submitting..." : "Submit claim"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MyClaims({ session }) {
  const [claims, setClaims] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    supabase
      .from("claims")
      .select("id, item_id, status, created_at")
      .eq("claimant_id", session.user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setClaims(data ?? []);
      });

    return () => {
      active = false;
    };
  }, [session]);

  return (
    <div className="form-card">
      <h2>Your claims</h2>
      {error && <p className="notice">{error}</p>}
      {claims.length === 0 && !error && <p>No claims submitted yet.</p>}

      {claims.map((claim) => (
        <article className="claim-row" key={claim.id}>
          <p><strong>Claim reference:</strong> {claim.id.slice(0, 8)}</p>
          <p><strong>Item reference:</strong> {claim.item_id}</p>
          <p><strong>Status:</strong> {claim.status}</p>
          <p className="muted">
            Submitted {new Date(claim.created_at).toLocaleDateString()}
          </p>
        </article>
      ))}
    </div>
  );
}

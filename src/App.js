import { useState } from "react";

const COLUMNS = [
  "University",
  "University Website",
  "City",
  "State",
  "Denomination / Association",
  "Name",
  "Title",
  "Email",
  "Phone",
  "LinkedIn",
  "Notes / Description",
  "Engagement Tools",
  "Undergraduate Population",
];

const APPS_SCRIPT_URL = process.env.REACT_APP_APPS_SCRIPT_URL;
const ANTHROPIC_API_KEY = process.env.REACT_APP_ANTHROPIC_API_KEY;
const HUNTER_API_KEY = process.env.REACT_APP_HUNTER_API_KEY;

const lookupEmailWithHunter = async (contact) => {
  if (!HUNTER_API_KEY || !contact.website || !contact.name) return "";
  const nameParts = contact.name.trim().split(/\s+/);
  if (nameParts.length < 2) return "";
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ");
  let domain;
  try {
    domain = new URL(contact.website).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${HUNTER_API_KEY}`
    );
    const data = await res.json();
    return data?.data?.email || "";
  } catch {
    return "";
  }
};

const SYSTEM_PROMPT = `You are a higher education research assistant. When given a US college or university name or website, find real contacts who have the words "Career", "Alumni", or "Student" in their job title, specifically in these departments: Career Services, Student Life, and Alumni Relations.

For each contact found, return a JSON array. Each object must have exactly these keys:
- university: Full official university name
- website: Official university website URL
- city: City where the university is located
- state: Two-letter US state abbreviation
- denomination: Any religious, political, or organizational affiliations/associations (comma-separated if multiple, empty string if none)
- name: The person's preferred/common name (not formal given name if they go by a nickname)
- title: Their exact job title
- email: Work email address (empty string if not found)
- phone: Work phone number (empty string if not found)
- linkedin: LinkedIn profile URL (empty string if not found)
- notes: Brief description of their role and focus areas
- tools: Known platforms or tools they use for student engagement, career services, or alumni engagement (e.g. Handshake, Salesforce, EverTrue, Graduway, etc.)
- undergrad_population: Approximate undergraduate student count as a number only

Return ONLY a valid JSON array, no markdown, no explanation. If you cannot find specific contacts, return the best available data with empty strings for missing fields. Focus on real people with verifiable information. Return between 1-10 contacts per school.`;

export default function App() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");

  const addLog = (msg, type = "info") => {
    setLog((prev) => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  };

  const researchSchool = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    addLog(`🔍 Researching: ${input.trim()}`, "info");

    try {
      // Call Claude API
      addLog("Calling Claude API to research contacts...", "info");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Research this US college/university and find contacts: ${input.trim()}`,
            },
          ],
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
            },
          ],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Claude API error");
      }

      // Extract text from response
      const textBlock = data.content?.find((b) => b.type === "text");
      if (!textBlock) throw new Error("No text response from Claude");

      let contacts;
      try {
        let cleaned = textBlock.text;
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          cleaned = jsonMatch[0];
        }
        contacts = JSON.parse(cleaned);
      } catch {
        throw new Error("Could not parse Claude response as JSON");
      }

      addLog(`✅ Found ${contacts.length} contact(s)`, "success");

      // Hunter.io email lookup
      if (HUNTER_API_KEY) {
        for (const contact of contacts) {
          addLog(`🔎 Hunter.io lookup for ${contact.name}...`, "info");
          const hunterEmail = await lookupEmailWithHunter(contact);
          if (hunterEmail) {
            contact.email = hunterEmail;
            addLog(`📧 Hunter found: ${hunterEmail}`, "success");
          } else {
            addLog(`— No Hunter email found for ${contact.name}`, "info");
          }
        }
      }

      // Send each contact to Google Apps Script
      let successCount = 0;
      for (const contact of contacts) {
        try {
          addLog(`📤 Sending ${contact.name} to Google Sheet...`, "info");
          await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              university: contact.university || "",
              website: contact.website || "",
              city: contact.city || "",
              state: contact.state || "",
              denomination: contact.denomination || "",
              name: contact.name || "",
              title: contact.title || "",
              email: contact.email || "",
              phone: contact.phone || "",
              linkedin: contact.linkedin || "",
              notes: contact.notes || "",
              tools: contact.tools || "",
              undergrad_population: contact.undergrad_population || "",
            }),
          });
          successCount++;
          addLog(`✅ ${contact.name} added to sheet`, "success");
        } catch {
          addLog(`⚠️ Failed to write ${contact.name} to sheet`, "error");
        }
      }

      setResults((prev) => [...contacts, ...prev]);
      addLog(`🎉 Done! ${successCount}/${contacts.length} contacts written to Google Sheet`, "success");
      setInput("");
    } catch (err) {
      setError(err.message);
      addLog(`❌ Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") researchSchool();
  };

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>W</span>
          <div>
            <div style={styles.logoTitle}>WorkerSpring</div>
            <div style={styles.logoSub}>Contact Intelligence</div>
          </div>
        </div>
        <div style={styles.headerBadge}>US Higher Ed · Career · Alumni · Student</div>
      </div>

      {/* Search Bar */}
      <div style={styles.searchSection}>
        <div style={styles.searchLabel}>Enter a university name or website</div>
        <div style={styles.searchRow}>
          <input
            style={styles.input}
            type="text"
            placeholder="e.g. Duke University or duke.edu"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
          />
          <button
            style={{ ...styles.btn, ...(loading ? styles.btnDisabled : {}) }}
            onClick={researchSchool}
            disabled={loading}
          >
            {loading ? (
              <span style={styles.spinner}>⏳</span>
            ) : (
              "Research"
            )}
          </button>
        </div>
        {error && <div style={styles.errorBanner}>⚠️ {error}</div>}
      </div>

      {/* Activity Log */}
      {log.length > 0 && (
        <div style={styles.logBox}>
          {log.slice(-6).map((entry, i) => (
            <div
              key={i}
              style={{
                ...styles.logEntry,
                color:
                  entry.type === "success"
                    ? "#22c55e"
                    : entry.type === "error"
                    ? "#f87171"
                    : "#94a3b8",
              }}
            >
              <span style={styles.logTime}>{entry.time}</span>
              {entry.msg}
            </div>
          ))}
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div style={styles.tableSection}>
          <div style={styles.tableHeader}>
            <span style={styles.tableTitle}>
              {results.length} Contact{results.length !== 1 ? "s" : ""} Found
            </span>
            <span style={styles.tableSubtitle}>All rows have been written to your Google Sheet</span>
          </div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col} style={styles.th}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                    <td style={styles.td}>{r.university}</td>
                    <td style={styles.td}>
                      {r.website ? (
                        <a href={r.website} target="_blank" rel="noreferrer" style={styles.link}>
                          {r.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : "—"}
                    </td>
                    <td style={styles.td}>{r.city}</td>
                    <td style={styles.td}>{r.state}</td>
                    <td style={styles.td}>{r.denomination || "—"}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{r.name}</td>
                    <td style={styles.td}>{r.title}</td>
                    <td style={styles.td}>
                      {r.email ? (
                        <a href={`mailto:${r.email}`} style={styles.link}>
                          {r.email}
                        </a>
                      ) : "—"}
                    </td>
                    <td style={styles.td}>{r.phone || "—"}</td>
                    <td style={styles.td}>
                      {r.linkedin ? (
                        <a href={r.linkedin} target="_blank" rel="noreferrer" style={styles.link}>
                          View
                        </a>
                      ) : "—"}
                    </td>
                    <td style={{ ...styles.td, maxWidth: 200 }}>{r.notes}</td>
                    <td style={styles.td}>{r.tools}</td>
                    <td style={styles.td}>
                      {r.undergrad_population
                        ? Number(r.undergrad_population).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results.length === 0 && !loading && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🎓</div>
          <div style={styles.emptyText}>Enter a university above to find contacts</div>
          <div style={styles.emptySubtext}>
            Searches for Career, Alumni & Student roles in Career Services, Student Life and Alumni Relations
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  root: {
    minHeight: "100vh",
    backgroundColor: "#0a0f1e",
    color: "#e2e8f0",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    padding: "0 0 60px 0",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "24px 40px",
    borderBottom: "1px solid #1e2d45",
    background: "linear-gradient(135deg, #0d1b2e 0%, #0a0f1e 100%)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  logoMark: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    fontWeight: 800,
    color: "#fff",
    flexShrink: 0,
    lineHeight: "42px",
    textAlign: "center",
  },
  logoTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#f1f5f9",
    letterSpacing: "-0.3px",
  },
  logoSub: {
    fontSize: 12,
    color: "#64748b",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  headerBadge: {
    fontSize: 12,
    color: "#3b82f6",
    background: "rgba(59,130,246,0.1)",
    border: "1px solid rgba(59,130,246,0.25)",
    borderRadius: 20,
    padding: "5px 14px",
    letterSpacing: "0.04em",
  },
  searchSection: {
    maxWidth: 800,
    margin: "40px auto 0",
    padding: "0 24px",
  },
  searchLabel: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 10,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  searchRow: {
    display: "flex",
    gap: 12,
  },
  input: {
    flex: 1,
    background: "#111827",
    border: "1px solid #1e2d45",
    borderRadius: 10,
    padding: "14px 18px",
    fontSize: 15,
    color: "#f1f5f9",
    outline: "none",
    transition: "border-color 0.2s",
  },
  btn: {
    background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "14px 28px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    letterSpacing: "-0.2px",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  errorBanner: {
    marginTop: 12,
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#f87171",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 13,
  },
  logBox: {
    margin: "20px auto 0",
    padding: "14px 20px",
    background: "#0d1117",
    border: "1px solid #1e2d45",
    borderRadius: 10,
    fontFamily: "monospace",
    fontSize: 12,
    maxHeight: 160,
    overflowY: "auto",
    marginLeft: "auto",
    marginRight: "auto",
    width: "calc(100% - 48px)",
    maxWidth: 752,
  },
  logEntry: {
    padding: "3px 0",
    display: "flex",
    gap: 10,
  },
  logTime: {
    color: "#334155",
    flexShrink: 0,
  },
  tableSection: {
    margin: "40px 24px 0",
    overflowX: "auto",
  },
  tableHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 16,
    marginBottom: 16,
    paddingLeft: 4,
  },
  tableTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#f1f5f9",
  },
  tableSubtitle: {
    fontSize: 13,
    color: "#22c55e",
  },
  tableWrap: {
    overflowX: "auto",
    borderRadius: 12,
    border: "1px solid #1e2d45",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    background: "#0d1b2e",
    color: "#64748b",
    padding: "12px 14px",
    textAlign: "left",
    whiteSpace: "nowrap",
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    borderBottom: "1px solid #1e2d45",
  },
  td: {
    padding: "11px 14px",
    borderBottom: "1px solid #0f1923",
    color: "#cbd5e1",
    verticalAlign: "top",
    maxWidth: 160,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  trEven: {
    background: "#0a0f1e",
  },
  trOdd: {
    background: "#0d1117",
  },
  link: {
    color: "#3b82f6",
    textDecoration: "none",
  },
  emptyState: {
    textAlign: "center",
    padding: "80px 24px",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 600,
    color: "#475569",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#334155",
    maxWidth: 400,
    margin: "0 auto",
    lineHeight: 1.6,
  },
};
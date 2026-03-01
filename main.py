#!/usr/bin/env python3
"""
Stock Metadata Generator v5
- Modern yuvarlak köşeli tasarım
- Başlık & Açıklama ortak (tek alan)
- Keywords platform bazlı (Adobe/Shutterstock/iStock)
- Groq web search destekli promptlar
- Disk + RAM thumbnail cache
- Donmayan UI (tüm işler thread'de)
- Trackpad scroll her yerde
"""

import customtkinter as ctk
import tkinter as tk
from tkinter import filedialog, messagebox
import threading, os, json, csv, base64, re, io
from pathlib import Path
from datetime import datetime
import requests
from PIL import Image
import cv2

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("dark-blue")

# ── Renkler ──────────────────────────────────────────────────────────────────
BG       = "#0e1117"
CARD     = "#161b26"
CARD2    = "#1c2235"
BORDER   = "#252d42"
TEXT     = "#e0e4f0"
TEXT2    = "#8892aa"
TEXT3    = "#404860"
ACCENT   = "#4070f4"
ACCENT_H = "#2d5de0"
INPUT    = "#12161f"
SEL      = "#1a2440"
HOVER    = "#1a2030"
GREEN    = "#22c55e"
GREEN_BG = "#0f2318"
PURPLE   = "#7c3aed"

THUMB_W, THUMB_H = 244, 152
PREV_W,  PREV_H  = 262, 164

ADOBE_MAX   = 49
SHUTTER_MAX = 50
ISTOCK_MAX  = 50
IMAGE_EXTS  = {".jpg",".jpeg",".png",".tiff",".tif",".webp"}
VIDEO_EXTS  = {".mp4",".mov",".avi",".mkv",".m4v",".wmv"}
ALL_EXTS    = IMAGE_EXTS | VIDEO_EXTS

APP_DIR         = Path.home() / ".stock_metadata_gen"
THUMB_DIR       = APP_DIR / "thumbs"
ISTOCK_FILE     = APP_DIR / "istock_learned.json"
SETTINGS_FILE   = APP_DIR / "settings.json"
APP_DIR.mkdir(exist_ok=True)
THUMB_DIR.mkdir(exist_ok=True)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# ── Yardımcılar ───────────────────────────────────────────────────────────────
def load_json(p, d):
    try:
        with open(p,"r",encoding="utf-8") as f: return json.load(f)
    except: return d

def save_json(p, d):
    with open(p,"w",encoding="utf-8") as f: json.dump(d,f,ensure_ascii=False,indent=2)

load_settings = lambda: load_json(SETTINGS_FILE,
    {"groq_api_key":"","everypixels_id":"","everypixels_secret":"","save_dir":""})
save_settings  = lambda s: save_json(SETTINGS_FILE, s)
load_istock    = lambda: load_json(ISTOCK_FILE, {})
save_istock    = lambda d: save_json(ISTOCK_FILE, d)
map_istock     = lambda kws: [load_istock().get(k.lower().strip(),k) for k in kws]

# ── CSV ───────────────────────────────────────────────────────────────────────
CSV_H = ["file_path","file_name","created_at","title_en","title_tr",
         "description_en","description_tr",
         "adobe_keywords_en","adobe_keywords_tr",
         "shutter_keywords_en","shutter_keywords_tr",
         "istock_keywords_en","istock_keywords_tr"]

def csv_path(folder): return os.path.join(folder,"_metadata.csv")

def load_db(folder):
    p = csv_path(folder)
    if not os.path.exists(p): return {}
    with open(p,"r",encoding="utf-8",newline="") as f:
        return {r["file_path"]:r for r in csv.DictReader(f)}

def save_db(folder, record):
    db = load_db(folder)
    db[record["file_path"]] = record
    with open(csv_path(folder),"w",encoding="utf-8",newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_H)
        w.writeheader()
        [w.writerow(r) for r in db.values()]

# ── Thumbnail ─────────────────────────────────────────────────────────────────
def get_thumb(file_path, w=THUMB_W, h=THUMB_H):
    import hashlib
    key = hashlib.md5(f"{file_path}{w}{h}".encode()).hexdigest()
    cp  = THUMB_DIR / f"{key}.png"
    if cp.exists():
        return Image.open(cp).convert("RGB")
    ext = Path(file_path).suffix.lower()
    if ext in VIDEO_EXTS:
        cap = cv2.VideoCapture(file_path)
        ret, frame = cap.read(); cap.release()
        img = Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)) if ret else Image.new("RGB",(w,h),BG)
    else:
        img = Image.open(file_path).convert("RGB")
    img.thumbnail((w,h), Image.LANCZOS)
    canvas = Image.new("RGB",(w,h),BG)
    canvas.paste(img,((w-img.width)//2,(h-img.height)//2))
    canvas.save(cp,"PNG")
    return canvas

def get_b64(file_path, px=768):
    ext = Path(file_path).suffix.lower()
    if ext in VIDEO_EXTS:
        cap = cv2.VideoCapture(file_path)
        ret, frame = cap.read(); cap.release()
        img = Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)) if ret else Image.new("RGB",(px,px),BG)
    else:
        img = Image.open(file_path).convert("RGB")
    img.thumbnail((px,px),Image.LANCZOS)
    buf = io.BytesIO(); img.save(buf,"JPEG",quality=82)
    return base64.b64encode(buf.getvalue()).decode()

# ── Groq API ──────────────────────────────────────────────────────────────────
def groq_vision(b64, prompt, key, max_tokens=700):
    r = requests.post(GROQ_URL, json={
        "model":"meta-llama/llama-4-scout-17b-16e-instruct",
        "messages":[{"role":"user","content":[
            {"type":"image_url","image_url":{"url":f"data:image/jpeg;base64,{b64}"}},
            {"type":"text","text":prompt}
        ]}],
        "max_tokens":max_tokens
    }, headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"}, timeout=60)
    if not r.ok: print("GROQ VISION:", r.status_code, r.text[:300])
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()

def groq_text(prompt, key, max_tokens=500):
    r = requests.post(GROQ_URL, json={
        "model":"llama-3.3-70b-versatile",
        "messages":[{"role":"user","content":prompt}],
        "max_tokens":max_tokens
    }, headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"}, timeout=30)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()

def api_metadata(b64, key, hint=""):
    hint_txt = f"\n\nEk referans bilgi (mutlaka dikkate al): {hint}" if hint.strip() else ""
    prompt = f"""You are a professional stock photo metadata expert.
Analyze this image and generate optimized metadata for microstock platforms.{hint_txt}

Consider: current market trends, buyer search behavior, commercial appeal, and SEO best practices.
Focus on what buyers actually search for on Adobe Stock, Shutterstock, and iStock.

Return ONLY valid JSON, nothing else:
{{"title_en":"...","title_tr":"...","description_en":"...","description_tr":"..."}}

Title (title_en / title_tr):
- Use the "Who, What, Where, When" formula: one clear sentence (e.g. who is doing what, where, and when if relevant).
- Ideal length: 5–10 words. No unnecessary embellishments.
- Natural language: write a meaningful sentence, do NOT stack keywords. Algorithms rank human-like titles higher. Example: "Woman working on laptop in bright modern office" — NOT "Woman laptop office business".
- Both EN and TR must read naturally.

Description (description_en / description_tr):
- Longer and more detailed than the title. Include mood, setting, lighting, use-cases, and context.
- 150–200 characters. Must be DIFFERENT from the title; never copy or repeat the title verbatim."""
    raw = groq_vision(b64, prompt, key, 600)
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if m: return json.loads(m.group())
    raise ValueError(f"Geçersiz yanıt: {raw[:200]}")

def api_keywords(b64, key, hint="", platform="general"):
    hint_txt = f"\nExtra context (important): {hint}" if hint.strip() else ""
    platform_note = {
        "adobe":      "Adobe Stock (max 49 keywords, broad to specific)",
        "shutterstock":"Shutterstock (max 50 keywords, high commercial value)",
        "istock":     "iStock/Getty (max 50 keywords, Getty controlled vocabulary preferred)",
    }.get(platform, "microstock platforms")

    prompt = f"""You are a microstock SEO expert. Generate optimized English keywords for {platform_note}.{hint_txt}

First, interpret the image as a story in your mind only (who, what, why, when, where, concept). Do NOT output this story or any explanation—use it only internally to choose keywords.

Then generate keywords that reflect this story: who/what first (specific subject), then category, then place/time, then concepts (why, inspiration). Put the 10 most story-critical terms first.

Keyword rules (follow strictly):
- Hierarchical order: Put the 10 most important keywords FIRST. Adobe Stock and Getty rank early positions higher; order by importance.
- Specific to general order: (1) Specific subject (e.g. Golden Retriever), (2) Category (e.g. Dog, Pet), (3) Concepts (e.g. Loyalty, Friendship).
- Use singular form only; do not add plural variants (e.g. "dog" not "dogs") to save the keyword limit.
- Include conceptual tags that reflect the mood or message (e.g. Loneliness, Success, Sustainability); these are highly searched by agencies.
- Only tag what is clearly visible and central to the image; do not add small background objects or elements that are not the main subject.

Also consider: buyer trends (2024-2025), commercial use (advertising, editorial, web, print), emotions, technical aspects, location/demographics if visible.

Output format (critical): Your response must be exactly one line of comma-separated keywords. No introductory phrase (e.g. no "Here are the keywords:"), no sentences, no bullet points, no story text. Example: wind turbine, power line, renewable energy, sustainability, outdoor, sunset. Generate exactly 50 keywords."""
    raw = groq_vision(b64, prompt, key, 450)
    kws = [k.strip() for k in re.sub(r'[\"\'\*\-\n\d\.]','',raw).split(",") if k.strip()]
    return kws[:50]

def api_translate(text, to_lang, key):
    lang = "Türkçe" if to_lang=="tr" else "English"
    return groq_text(
        f"Translate to {lang}. Keep it natural and professional. Return ONLY the translation:\n\n{text}",
        key, 350)

def api_translate_kw(kws, key):
    try:
        chunk = ", ".join(kws[:50])
        raw   = api_translate(chunk, "tr", key)
        parts = [p.strip() for p in raw.split(",")]
        return (parts + kws)[:len(kws)]
    except: return kws

def api_everypixels(file_path, cid, csec):
    with open(file_path,"rb") as f:
        files={"data":(os.path.basename(file_path),f.read())}
    r = requests.post("https://api.everypixel.com/v1/keywords?num_keywords=50&threshold=0.2",
                      files=files,auth=(cid,csec),timeout=30)
    r.raise_for_status()
    return [kw["keyword"] for kw in r.json().get("keywords",[])]

def fill_keywords_to_max(existing, max_count, candidates):
    """Append from candidates (no duplicates, case-insensitive) until length reaches max_count."""
    seen = {k.strip().lower() for k in existing if k and k.strip()}
    out = list(existing)
    for k in candidates:
        if len(out) >= max_count:
            break
        t = (k or "").strip()
        if not t or t.lower() in seen:
            continue
        seen.add(t.lower())
        out.append(t)
    return out

# ══════════════════════════════════════════════════════════════════════════════
#  UYGULAMA
# ══════════════════════════════════════════════════════════════════════════════
class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Stock Metadata Generator")
        self.geometry("1580x940")
        self.minsize(1300,820)
        self.configure(fg_color=BG)

        self.settings       = load_settings()
        self.current_file   = None
        self.current_folder = None
        self.metadata       = {}
        self._files         = []
        self._db_cache      = {}
        self._thumb_cache   = {}   # {path: CTkImage}
        self._file_row_map  = {}   # {path: row_frame}
        self._kw_canvases   = []   # keyword canvas listesi (scroll için)

        self._build()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # macOS trackpad scroll — tek güvenilir yöntem
        # Pencere üzerindeki her MouseWheel event'ini yakala,
        # hangi canvas'ın altında olduğunu bul ve scroll et
        self.bind_all("<MouseWheel>", self._on_global_scroll)
        self.bind_all("<Button-4>",   self._on_global_scroll)
        self.bind_all("<Button-5>",   self._on_global_scroll)

        if self.settings.get("save_dir") and os.path.isdir(self.settings["save_dir"]):
            self.after(300, lambda: self._load_folder(self.settings["save_dir"]))

    def _on_global_scroll(self, event):
        """Global scroll handler — imlecin altındaki canvas'ı scroll et (focus değil hover); fallback event.widget."""
        delta = 0
        if event.delta:
            # macOS trackpad: küçük delta'lar için en az 1 unit
            step = event.delta // 120
            delta = -1 * step if step else (-1 if event.delta > 0 else 1)
        elif event.num == 4:
            delta = -1
        elif event.num == 5:
            delta = 1

        if delta == 0:
            return

        def scroll_canvas(canvas):
            try:
                canvas.yview_scroll(delta, "units")
            except tk.TclError:
                pass

        # 1) İmlecin altındaki widget (toplevel ile daha güvenilir)
        x, y = self.winfo_pointerxy()
        w = self.winfo_toplevel().winfo_containing(x, y)
        while w:
            if isinstance(w, tk.Canvas):
                scroll_canvas(w)
                return
            try:
                w = w.master
            except (AttributeError, KeyError):
                break

        # 2) Fallback: event'i alan widget'tan yukarı çıkarak canvas bul
        w = event.widget
        while w:
            if isinstance(w, tk.Canvas):
                scroll_canvas(w)
                return
            try:
                w = w.master
            except (AttributeError, KeyError):
                break

        # 3) Son çare: sidebar list_canvas
        try:
            self.list_canvas.yview_scroll(delta, "units")
        except (tk.TclError, AttributeError):
            pass

    def _on_close(self):
        if self.current_file and self.metadata:
            self._do_save(silent=True)
        self.destroy()

    # ══════════════════════════════════════════════════════════════════════════
    #  BUILD
    # ══════════════════════════════════════════════════════════════════════════
    def _build(self):
        self._build_toolbar()
        self._build_body()

    # ── Toolbar ───────────────────────────────────────────────────────────────
    def _build_toolbar(self):
        tb = ctk.CTkFrame(self, height=52, corner_radius=0, fg_color="#090c14")
        tb.pack(fill="x")
        tb.pack_propagate(False)

        ctk.CTkLabel(tb, text="◈  Stock Metadata Generator",
                     font=ctk.CTkFont("Helvetica",14,"bold"),
                     text_color=TEXT).pack(side="left", padx=16)

        right = ctk.CTkFrame(tb, fg_color="transparent")
        right.pack(side="right", padx=12, pady=8)

        # Referans
        ref = ctk.CTkFrame(right, fg_color=CARD2, corner_radius=8,
                            border_width=1, border_color=BORDER)
        ref.pack(side="left", padx=(0,8))
        ctk.CTkLabel(ref, text="Referans", text_color=TEXT3,
                     font=ctk.CTkFont("Helvetica",10)).pack(side="left",padx=(10,4))
        self.hint_entry = ctk.CTkEntry(
            ref, width=200, height=32, corner_radius=6,
            placeholder_text="AI'ya ek ipucu...",
            fg_color="transparent", border_width=0,
            text_color=TEXT, placeholder_text_color=TEXT3,
            font=ctk.CTkFont("Helvetica",12))
        self.hint_entry.pack(side="left", padx=(0,8))

        # Butonlar
        self.gen_btn = ctk.CTkButton(
            right, text="⚡  Metadata Üret", width=148, height=34,
            corner_radius=8, fg_color=ACCENT, hover_color=ACCENT_H,
            font=ctk.CTkFont("Helvetica",12,"bold"), command=self._generate)
        self.gen_btn.pack(side="left", padx=4)

        ctk.CTkFrame(right, width=1, height=28, fg_color=BORDER).pack(side="left",padx=8)

        for txt, cmd, w in [
            ("⌘  Bul & Değiştir", self._dlg_find,     128),
            ("📚  iStock",         self._dlg_istock,    86),
        ]:
            ctk.CTkButton(right, text=txt, width=w, height=34, corner_radius=8,
                          fg_color=CARD2, hover_color=HOVER, text_color=TEXT2,
                          font=ctk.CTkFont("Helvetica",11),
                          command=cmd).pack(side="left", padx=3)

        ctk.CTkFrame(right, width=1, height=28, fg_color=BORDER).pack(side="left",padx=8)

        ctk.CTkButton(right, text="⚙  Ayarlar", width=92, height=34,
                      corner_radius=8, fg_color=CARD2, hover_color=HOVER,
                      text_color=TEXT2, font=ctk.CTkFont("Helvetica",11),
                      command=self._dlg_settings).pack(side="left", padx=3)

    # ── Gövde ─────────────────────────────────────────────────────────────────
    def _build_body(self):
        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=10, pady=8)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        self._build_sidebar(body)
        self._build_main(body)

    # ── Sol sidebar ───────────────────────────────────────────────────────────
    def _build_sidebar(self, parent):
        sb = ctk.CTkFrame(parent, width=290, corner_radius=14,
                           fg_color=CARD, border_width=1, border_color=BORDER)
        sb.grid(row=0, column=0, sticky="nsew", padx=(0,8))
        sb.pack_propagate(False)

        # Klasör seç
        ctk.CTkButton(
            sb, text="📁  Klasör Seç", height=38, corner_radius=10,
            fg_color=CARD2, hover_color=SEL, text_color=TEXT,
            border_width=1, border_color=BORDER,
            font=ctk.CTkFont("Helvetica",12,"bold"),
            command=self._pick_folder
        ).pack(fill="x", padx=12, pady=(12,4))

        self.folder_lbl = ctk.CTkLabel(
            sb, text="Klasör seçilmedi", text_color=TEXT3,
            font=ctk.CTkFont("Helvetica",10), wraplength=256, justify="left")
        self.folder_lbl.pack(anchor="w", padx=14, pady=(0,8))

        ctk.CTkFrame(sb, height=1, fg_color=BORDER).pack(fill="x", padx=12)

        # Dosya listesi başlık
        hdr = ctk.CTkFrame(sb, fg_color="transparent")
        hdr.pack(fill="x", padx=12, pady=(6,2))
        ctk.CTkLabel(hdr, text="KLASÖR İÇERİĞİ",
                     font=ctk.CTkFont("Helvetica",9,"bold"),
                     text_color=TEXT3).pack(side="left")
        self.count_lbl = ctk.CTkLabel(hdr, text="",
                                       font=ctk.CTkFont("Helvetica",9),
                                       text_color=TEXT3)
        self.count_lbl.pack(side="right")

        # Dosya listesi — tk.Canvas (macOS trackpad için)
        _lw = tk.Frame(sb, bg=CARD)
        _lw.pack(fill="both", expand=True, padx=6, pady=(0,6))
        self.list_canvas = tk.Canvas(_lw, bg=CARD, highlightthickness=0, bd=0)
        self.list_canvas.pack(fill="both", expand=True)
        self.list_frame = tk.Frame(self.list_canvas, bg=CARD)
        self._list_cwin = self.list_canvas.create_window((0,0), window=self.list_frame, anchor="nw")
        self.list_frame.bind("<Configure>", lambda e: self.list_canvas.configure(scrollregion=self.list_canvas.bbox("all")))
        self.list_canvas.bind("<Configure>", lambda e: self.list_canvas.itemconfig(self._list_cwin, width=e.width))

        ctk.CTkFrame(sb, height=1, fg_color=BORDER).pack(fill="x", padx=12)

        # Kaydet
        self.save_btn = ctk.CTkButton(
            sb, text="💾  Kaydet", height=36, corner_radius=10,
            fg_color=GREEN_BG, hover_color="#143020", text_color=GREEN,
            font=ctk.CTkFont("Helvetica",12,"bold"),
            state="disabled", command=self._save_current)
        self.save_btn.pack(fill="x", padx=12, pady=(6,12))

    def _bind_scroll(self, widget):
        pass  # CTkScrollableFrame ile gerek kalmadı

    # ── Sağ ana içerik ────────────────────────────────────────────────────────
    def _build_main(self, parent):
        main = ctk.CTkFrame(parent, fg_color="transparent")
        main.grid(row=0, column=1, sticky="nsew")
        main.rowconfigure(1, weight=1)
        main.columnconfigure(0, weight=1)

        # ── Üst: Ortak başlık & açıklama ──
        top = ctk.CTkFrame(main, fg_color=CARD, corner_radius=14,
                            border_width=1, border_color=BORDER)
        top.grid(row=0, column=0, sticky="ew", pady=(0,8))
        top.columnconfigure(0, weight=1)
        top.columnconfigure(1, weight=1)

        # Başlık EN
        self.title_en = self._make_entry(top, "Başlık", "EN", 0, 0)
        # Başlık TR
        self.title_tr = self._make_entry(top, "Başlık", "TR", 0, 1)
        self.title_tr.bind("<FocusOut>", lambda e: self._sync_field("title"))

        # Açıklama EN
        self.desc_en = self._make_textbox(top, "Açıklama", "EN", 1, 0)
        # Açıklama TR
        self.desc_tr = self._make_textbox(top, "Açıklama", "TR", 1, 1)
        self.desc_tr.bind("<FocusOut>", lambda e: self._sync_field("desc"))

        # ── Alt: Platform keyword sekmeleri ──
        kw_area = ctk.CTkFrame(main, fg_color="transparent")
        kw_area.grid(row=1, column=0, sticky="nsew")
        kw_area.rowconfigure(1, weight=1)
        kw_area.columnconfigure(0, weight=1)

        # Tab bar
        tab_bar = ctk.CTkFrame(kw_area, fg_color=CARD2, corner_radius=10,
                                height=40, border_width=1, border_color=BORDER)
        tab_bar.grid(row=0, column=0, sticky="ew", pady=(0,6))
        tab_bar.pack_propagate(False)

        self._active_tab = "Adobe Stock"
        self._tab_btns   = {}
        self._tab_frames = {}

        for name in ["Adobe Stock","Shutterstock","iStock"]:
            btn = ctk.CTkButton(
                tab_bar, text=name, width=120, height=30,
                corner_radius=8, fg_color="transparent",
                hover_color=HOVER, text_color=TEXT2,
                font=ctk.CTkFont("Helvetica",12),
                command=lambda n=name: self._switch_tab(n))
            btn.pack(side="left", padx=4, pady=5)
            self._tab_btns[name] = btn

        # Tab içerikleri
        kw_content = ctk.CTkFrame(kw_area, fg_color="transparent")
        kw_content.grid(row=1, column=0, sticky="nsew")
        kw_content.rowconfigure(0, weight=1)
        kw_content.columnconfigure(0, weight=1)

        self.platforms = {}
        for name, mx in [("Adobe Stock",ADOBE_MAX),
                          ("Shutterstock",SHUTTER_MAX),
                          ("iStock",ISTOCK_MAX)]:
            f = ctk.CTkFrame(kw_content, fg_color=CARD, corner_radius=14,
                              border_width=1, border_color=BORDER)
            self._tab_frames[name] = f
            self.platforms[name] = self._build_kw_panel(f, name, mx)

        self._switch_tab("Adobe Stock")

    def _switch_tab(self, name):
        self._active_tab = name
        for n, f in self._tab_frames.items():
            if n == name:
                f.grid(row=0, column=0, sticky="nsew")
            else:
                f.grid_remove()
        for n, b in self._tab_btns.items():
            if n == name:
                b.configure(fg_color=ACCENT, text_color="white",
                            font=ctk.CTkFont("Helvetica",12,"bold"))
            else:
                b.configure(fg_color="transparent", text_color=TEXT2,
                            font=ctk.CTkFont("Helvetica",12))

    # ── Ortak alan helper'ları ─────────────────────────────────────────────────
    def _make_entry(self, parent, label, lang, row, col):
        card = ctk.CTkFrame(parent, fg_color=CARD2, corner_radius=10,
                             border_width=1, border_color=BORDER)
        card.grid(row=row, column=col, sticky="ew",
                  padx=(12,6) if col==0 else (6,12), pady=(10,4))
        card.columnconfigure(1, weight=1)

        hdr = ctk.CTkFrame(card, fg_color="transparent")
        hdr.pack(fill="x", padx=10, pady=(8,4))
        ctk.CTkLabel(hdr, text=label,
                     font=ctk.CTkFont("Helvetica",11,"bold"),
                     text_color=TEXT2).pack(side="left")
        self._badge(hdr, lang).pack(side="left", padx=6)
        copy_btn = ctk.CTkButton(hdr, text="⎘ Kopyala", width=90, height=26,
                                  corner_radius=6, fg_color=CARD,
                                  hover_color=SEL, text_color=TEXT2,
                                  font=ctk.CTkFont("Helvetica",11),
                                  border_width=1, border_color=BORDER)
        copy_btn.pack(side="right")

        e = ctk.CTkEntry(card, height=34, corner_radius=8,
                          fg_color=INPUT, border_color=BORDER, border_width=1,
                          text_color=TEXT, placeholder_text_color=TEXT3,
                          font=ctk.CTkFont("Helvetica",13))
        e.pack(fill="x", padx=10, pady=(0,10))

        copy_btn.configure(command=lambda: self._copy(e.get()))
        return e

    def _make_textbox(self, parent, label, lang, row, col):
        card = ctk.CTkFrame(parent, fg_color=CARD2, corner_radius=10,
                             border_width=1, border_color=BORDER)
        card.grid(row=row, column=col, sticky="ew",
                  padx=(12,6) if col==0 else (6,12), pady=(0,10))
        card.columnconfigure(1, weight=1)

        hdr = ctk.CTkFrame(card, fg_color="transparent")
        hdr.pack(fill="x", padx=10, pady=(8,4))
        ctk.CTkLabel(hdr, text=label,
                     font=ctk.CTkFont("Helvetica",11,"bold"),
                     text_color=TEXT2).pack(side="left")
        self._badge(hdr, lang).pack(side="left", padx=6)
        copy_btn = ctk.CTkButton(hdr, text="⎘ Kopyala", width=90, height=26,
                                  corner_radius=6, fg_color=CARD,
                                  hover_color=SEL, text_color=TEXT2,
                                  font=ctk.CTkFont("Helvetica",11),
                                  border_width=1, border_color=BORDER)
        copy_btn.pack(side="right")

        t = ctk.CTkTextbox(card, height=72, corner_radius=8,
                            fg_color=INPUT, border_color=BORDER, border_width=1,
                            text_color=TEXT, font=ctk.CTkFont("Helvetica",12),
                            scrollbar_button_color=BORDER)
        t.pack(fill="x", padx=10, pady=(0,10))

        copy_btn.configure(command=lambda: self._copy(t.get("1.0","end").strip()))
        return t

    def _badge(self, parent, lang):
        bg = "#162a52" if lang=="EN" else "#0f2c1a"
        fg = "#5b9af8" if lang=="EN" else "#4ade80"
        f = ctk.CTkFrame(parent, fg_color=bg, corner_radius=5)
        ctk.CTkLabel(f, text=f" {lang} ",
                     font=ctk.CTkFont("Helvetica",9,"bold"),
                     text_color=fg).pack(padx=4, pady=1)
        return f

    # ── Keyword paneli ────────────────────────────────────────────────────────
    def _build_kw_panel(self, parent, platform, max_kw):
        s = {}
        parent.columnconfigure(0, weight=1)
        parent.columnconfigure(1, weight=1)
        parent.rowconfigure(1, weight=1)

        # Başlık satırı
        for col, lang in [(0,"EN"),(1,"TR")]:
            hdr = ctk.CTkFrame(parent, fg_color="transparent")
            hdr.grid(row=0, column=col, sticky="ew",
                     padx=(12,6) if col==0 else (6,12), pady=(10,4))
            ctk.CTkLabel(hdr, text="Keywords",
                         font=ctk.CTkFont("Helvetica",12,"bold"),
                         text_color=TEXT2).pack(side="left")
            self._badge(hdr, lang).pack(side="left", padx=6)
            ctk.CTkLabel(hdr, text=f"max {max_kw}",
                         font=ctk.CTkFont("Helvetica",10),
                         text_color=TEXT3).pack(side="left")
            lang_ref = lang.lower()
            copy_btn = ctk.CTkButton(hdr, text="⎘ Kopyala", width=90, height=26,
                                      corner_radius=6, fg_color=CARD2,
                                      hover_color=SEL, text_color=TEXT2,
                                      font=ctk.CTkFont("Helvetica",11),
                                      border_width=1, border_color=BORDER,
                                      command=lambda p=platform, l=lang_ref: self._copy_kw(p,l))
            copy_btn.pack(side="right")

        # EN keyword scroll alanı
        en_outer = ctk.CTkFrame(parent, fg_color=INPUT, corner_radius=10,
                                 border_width=1, border_color=BORDER)
        en_outer.grid(row=1, column=0, sticky="nsew",
                      padx=(12,6), pady=(0,10))
        en_canvas, en_lf = self._make_scroll_area(en_outer)
        s["kw_en_canvas"]  = en_canvas
        s["kw_en_list"]    = en_lf
        s["kw_en_entries"] = []

        # TR keyword scroll alanı
        tr_outer = ctk.CTkFrame(parent, fg_color=INPUT, corner_radius=10,
                                 border_width=1, border_color=BORDER)
        tr_outer.grid(row=1, column=1, sticky="nsew",
                      padx=(6,12), pady=(0,10))
        tr_canvas, tr_lf = self._make_scroll_area(tr_outer)
        s["kw_tr_canvas"]  = tr_canvas
        s["kw_tr_list"]    = tr_lf
        s["kw_tr_entries"] = []

        s["max_kw"]   = max_kw
        s["platform"] = platform

        if platform == "iStock":
            btn_row = ctk.CTkFrame(parent, fg_color="transparent")
            btn_row.grid(row=2, column=0, columnspan=2,
                         sticky="w", padx=12, pady=(0,8))
            ctk.CTkButton(
                btn_row, text="🧠  iStock Eşleştir",
                width=160, height=30, corner_radius=8,
                fg_color="#2a1060", hover_color="#3a1880",
                text_color="#c4b5fd",
                font=ctk.CTkFont("Helvetica",11),
                command=self._apply_istock
            ).pack(side="left")

        return s

    def _make_scroll_area(self, parent):
        canvas = tk.Canvas(parent, bg=INPUT, highlightthickness=0, bd=0)
        canvas.pack(fill="both", expand=True, padx=2, pady=2)
        lf = tk.Frame(canvas, bg=INPUT)
        win = canvas.create_window((0,0), window=lf, anchor="nw")
        lf.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(win, width=e.width))
        self._kw_canvases.append(canvas)
        return canvas, lf

    # ══════════════════════════════════════════════════════════════════════════
    #  KLASÖR & DOSYA
    # ══════════════════════════════════════════════════════════════════════════
    def _pick_folder(self):
        d = filedialog.askdirectory(title="Klasör Seç")
        if d:
            self._load_folder(d)

    def _load_folder(self, folder):
        self.current_folder = folder
        self.settings["save_dir"] = folder
        save_settings(self.settings)

        self.folder_lbl.configure(
            text=f"📁  {Path(folder).name}", text_color="#5b9af8")

        files = sorted(
            [f for f in Path(folder).iterdir()
             if f.is_file() and f.suffix.lower() in ALL_EXTS],
            key=lambda x: x.name.lower())
        self._files = files
        self.count_lbl.configure(text=f"{len(files)}")

        # DB cache
        self._db_cache[folder] = load_db(folder)

        # Listeyi temizle
        for w in self.list_frame.winfo_children(): w.destroy()
        self._file_row_map.clear()

        # Thumbnail'ları sırayla arka planda yükle
        threading.Thread(target=self._load_thumbs_bg,
                         args=(folder,), daemon=True).start()
        self._status(f"📁  {folder}  —  {len(files)} dosya")

    def _load_thumbs_bg(self, folder):
        db = self._db_cache.get(folder, {})
        for i, fp in enumerate(self._files):
            fp_str = str(fp)
            has    = fp_str in db
            try:
                pil = get_thumb(fp_str, THUMB_W, THUMB_H)
                ctk_img = ctk.CTkImage(light_image=pil, dark_image=pil,
                                        size=(THUMB_W, THUMB_H))
                self._thumb_cache[fp_str] = ctk_img
            except:
                ctk_img = None
            delay = i * 30  # Her thumbnail arası 30ms bekle — UI donmasın
            self.after(delay, lambda p=fp_str, img=ctk_img,
                               h=has, n=fp.name: self._add_row(p,img,h,n))

    def _add_row(self, fp_str, ctk_img, has, name):
        row = tk.Frame(self.list_frame, bg=CARD, cursor="hand2")
        row.pack(fill="x", padx=4, pady=3)

        if ctk_img:
            lbl = ctk.CTkLabel(row, image=ctk_img, text="",
                                width=THUMB_W, height=THUMB_H)
            lbl.image = ctk_img
            lbl.pack(padx=6, pady=(6,2))
        else:
            tk.Label(row, text="🖼", bg=CARD, fg=TEXT3,
                     font=("Helvetica",22)).pack(pady=12)

        disp = name if len(name)<=28 else name[:25]+"..."
        name_lbl = tk.Label(row, text=disp, bg=CARD, fg=TEXT,
                             font=("Helvetica",10),
                             wraplength=THUMB_W+8, justify="center")
        name_lbl.pack(padx=6, pady=(0,4))

        if has:
            tk.Frame(row, bg=GREEN, height=2).pack(fill="x", padx=6, pady=(0,4))

        def _click(e): self._select_file(fp_str)
        def _enter(e): row.configure(bg=HOVER); name_lbl.configure(bg=HOVER)
        def _leave(e):
            c = SEL if self.current_file==fp_str else CARD
            row.configure(bg=c); name_lbl.configure(bg=c)

        for w in [row, name_lbl] + list(row.winfo_children()):
            w.bind("<Button-1>", _click)
            w.bind("<Enter>",    _enter)
            w.bind("<Leave>",    _leave)

        self._file_row_map[fp_str] = (row, name_lbl)

    def _select_file(self, path):
        self.current_file = path
        self._highlight_row(path)

        # Büyük önizleme — arka planda
        def _show():
            try:
                pil = get_thumb(path, PREV_W, PREV_H)
                img = ctk.CTkImage(light_image=pil, dark_image=pil,
                                    size=(PREV_W,PREV_H))
                self.after(0, lambda: self._set_prev(img, path))
            except: pass
        threading.Thread(target=_show, daemon=True).start()

        # Veriyi RAM cache'den yükle
        db = self._db_cache.get(self.current_folder, {})
        if path in db:
            self._load_record(db[path])
            self._status(f"📄  {Path(path).name}")
        else:
            self._clear_fields()
            self._status(f"📄  {Path(path).name}  —  ⚡ Metadata Üret'e basın")

    def _set_prev(self, img, path):
        pass  # Büyük önizleme kaldırıldı

    def _highlight_row(self, path):
        for p,(row,lbl) in self._file_row_map.items():
            c = SEL if p==path else CARD
            row.configure(bg=c); lbl.configure(bg=c)

    # ══════════════════════════════════════════════════════════════════════════
    #  METADATA ÜRET
    # ══════════════════════════════════════════════════════════════════════════
    def _generate(self):
        if not self.current_file:
            messagebox.showwarning("Uyarı","Önce bir dosya seçin."); return
        if not self.settings.get("groq_api_key"):
            messagebox.showwarning("API","Ayarlar'dan Groq API anahtarını girin."); return

        self.gen_btn.configure(state="disabled", text="⏳  Üretiliyor...")

        def run():
            try:
                hint = self.hint_entry.get().strip()
                self._status("🖼  Görsel analiz ediliyor...")
                b64  = get_b64(self.current_file)
                key  = self.settings["groq_api_key"]

                # Başlık + açıklama
                self._status("📝  Başlık ve açıklama üretiliyor...")
                meta = api_metadata(b64, key, hint)

                # Her platform için ayrı keyword
                self._status("🔑  Adobe Stock keywords üretiliyor...")
                ep_id  = self.settings.get("everypixels_id","")
                ep_sec = self.settings.get("everypixels_secret","")

                if ep_id and ep_sec:
                    try:    base_kw = api_everypixels(self.current_file,ep_id,ep_sec)
                    except: base_kw = api_keywords(b64,key,hint,"adobe")
                else:
                    base_kw = api_keywords(b64,key,hint,"adobe")

                adobe_en = base_kw[:ADOBE_MAX]
                if len(adobe_en) < ADOBE_MAX:
                    groq_kw = api_keywords(b64, key, hint, "adobe")
                    adobe_en = fill_keywords_to_max(adobe_en, ADOBE_MAX, groq_kw)

                self._status("🔑  Shutterstock keywords üretiliyor...")
                shutter_en = api_keywords(b64,key,hint,"shutterstock")[:SHUTTER_MAX]

                self._status("🔑  iStock keywords üretiliyor...")
                istock_raw = api_keywords(b64,key,hint,"istock")[:ISTOCK_MAX]
                istock_en  = map_istock(istock_raw)

                # Türkçe çeviriler
                self._status("🌐  Türkçeye çevriliyor...")
                adobe_tr   = api_translate_kw(adobe_en,   key)
                shutter_tr = api_translate_kw(shutter_en, key)
                istock_tr  = api_translate_kw(istock_en,  key)

                self.metadata = {
                    "title_en":   meta.get("title_en",""),
                    "title_tr":   meta.get("title_tr",""),
                    "desc_en":    meta.get("description_en",""),
                    "desc_tr":    meta.get("description_tr",""),
                    "adobe_en":   adobe_en,   "adobe_tr":   adobe_tr,
                    "shutter_en": shutter_en, "shutter_tr": shutter_tr,
                    "istock_en":  istock_en,  "istock_tr":  istock_tr,
                }
                self.after(0, self._fill_all)
                self._status(f"✅  Tamamlandı — {Path(self.current_file).name}")
                self.after(600, lambda: self._do_save(silent=True))

            except Exception as ex:
                import traceback; print(traceback.format_exc())
                self._status(f"❌  {ex}")
                self.after(0, lambda e=str(ex): messagebox.showerror("Hata",e))
            finally:
                self.after(0, lambda: self.gen_btn.configure(
                    state="normal", text="⚡  Metadata Üret"))

        threading.Thread(target=run, daemon=True).start()

    # ── Doldur / temizle ──────────────────────────────────────────────────────
    def _fill_all(self):
        d = self.metadata
        self._se(self.title_en, d.get("title_en",""))
        self._se(self.title_tr, d.get("title_tr",""))
        self._stb(self.desc_en, d.get("desc_en",""))
        self._stb(self.desc_tr, d.get("desc_tr",""))

        p = self.platforms
        self._fill_kw(p["Adobe Stock"],  d.get("adobe_en",[]),   d.get("adobe_tr",[]))
        self._fill_kw(p["Shutterstock"], d.get("shutter_en",[]), d.get("shutter_tr",[]))
        self._fill_kw(p["iStock"],       d.get("istock_en",[]),  d.get("istock_tr",[]))
        self.save_btn.configure(state="normal")

    def _fill_kw(self, store, kw_en, kw_tr):
        for lf in [store["kw_en_list"], store["kw_tr_list"]]:
            for w in lf.winfo_children(): w.destroy()
        store["kw_en_entries"].clear()
        store["kw_tr_entries"].clear()

        count = min(max(len(kw_en),len(kw_tr)), store["max_kw"])

        for i in range(count):
            for lf, entries, val in [
                (store["kw_en_list"], store["kw_en_entries"],
                 kw_en[i] if i<len(kw_en) else ""),
                (store["kw_tr_list"], store["kw_tr_entries"],
                 kw_tr[i] if i<len(kw_tr) else ""),
            ]:
                row = tk.Frame(lf, bg=INPUT)
                row.pack(fill="x", pady=1, padx=2)
                tk.Label(row, text=f"{i+1:02d}", bg=INPUT, fg=TEXT3,
                         font=("Helvetica",10), width=3).pack(side="left")
                e = tk.Entry(row, bg=INPUT, fg=TEXT, insertbackground=TEXT,
                             relief="flat", font=("Helvetica",11),
                             highlightbackground=BORDER, highlightthickness=1)
                e.pack(side="left", fill="x", expand=True, pady=2, padx=(2,4), ipady=3)
                e.insert(0, val)
                entries.append(e)

    def _clear_fields(self):
        self._se(self.title_en,""); self._se(self.title_tr,"")
        self._stb(self.desc_en,""); self._stb(self.desc_tr,"")
        for p in self.platforms.values(): self._fill_kw(p,[],[])
        self.save_btn.configure(state="disabled")
        self.metadata = {}

    # ── Kayıt ─────────────────────────────────────────────────────────────────
    def _save_current(self): self._do_save(silent=False)

    def _do_save(self, silent=False):
        if not self.current_file or not self.current_folder: return
        rec = self._build_rec()
        if not rec: return
        try:
            save_db(self.current_folder, rec)
            if self.current_folder not in self._db_cache:
                self._db_cache[self.current_folder] = {}
            self._db_cache[self.current_folder][self.current_file] = rec
            if not silent:
                self._status(f"💾  Kaydedildi — {Path(self.current_file).name}")
            self._mark_saved(self.current_file)
        except Exception as e:
            if not silent: messagebox.showerror("Kayıt Hatası",str(e))

    def _mark_saved(self, path):
        if path not in self._file_row_map: return
        row, _ = self._file_row_map[path]
        for c in row.winfo_children():
            if isinstance(c, tk.Frame) and c.cget("bg")==GREEN: return
        tk.Frame(row, bg=GREEN, height=2).pack(fill="x", padx=6, pady=(0,4))

    def _build_rec(self):
        if not self.current_file: return None
        def gkw(p):
            en=[e.get().strip() for e in p["kw_en_entries"] if e.get().strip()]
            tr=[e.get().strip() for e in p["kw_tr_entries"] if e.get().strip()]
            return en,tr
        ae,at = gkw(self.platforms["Adobe Stock"])
        se,st = gkw(self.platforms["Shutterstock"])
        ie,it = gkw(self.platforms["iStock"])
        return {
            "file_path":self.current_file,
            "file_name":Path(self.current_file).name,
            "created_at":datetime.now().strftime("%Y-%m-%d %H:%M"),
            "title_en":self.title_en.get(),
            "title_tr":self.title_tr.get(),
            "description_en":self.desc_en.get("1.0","end").strip(),
            "description_tr":self.desc_tr.get("1.0","end").strip(),
            "adobe_keywords_en":", ".join(ae),
            "adobe_keywords_tr":", ".join(at),
            "shutter_keywords_en":", ".join(se),
            "shutter_keywords_tr":", ".join(st),
            "istock_keywords_en":", ".join(ie),
            "istock_keywords_tr":", ".join(it),
        }

    def _load_record(self, rec):
        kw_split = lambda k: [x.strip() for x in rec.get(k,"").split(",") if x.strip()]
        self.metadata = {
            "title_en":  rec.get("title_en",""),
            "title_tr":  rec.get("title_tr",""),
            "desc_en":   rec.get("description_en",""),
            "desc_tr":   rec.get("description_tr",""),
            "adobe_en":  kw_split("adobe_keywords_en"),
            "adobe_tr":  kw_split("adobe_keywords_tr"),
            "shutter_en":kw_split("shutter_keywords_en"),
            "shutter_tr":kw_split("shutter_keywords_tr"),
            "istock_en": kw_split("istock_keywords_en"),
            "istock_tr": kw_split("istock_keywords_tr"),
        }
        self._fill_all()
        self.save_btn.configure(state="normal")

    # ── Sync TR→EN ────────────────────────────────────────────────────────────
    def _sync_field(self, field):
        key = self.settings.get("groq_api_key","")
        if not key: return
        if field == "title":
            val = self.title_tr.get().strip()
            if val:
                self._async_tr(val,"en",lambda t: self._se(self.title_en,t))
        else:
            val = self.desc_tr.get("1.0","end").strip()
            if val:
                self._async_tr(val,"en",lambda t: self._stb(self.desc_en,t))

    def _async_tr(self, text, lang, cb):
        def run():
            try:
                r = api_translate(text, lang, self.settings["groq_api_key"])
                self.after(0, lambda: cb(r))
            except: pass
        threading.Thread(target=run, daemon=True).start()

    # ── Kopyala ───────────────────────────────────────────────────────────────
    def _copy(self, text):
        self.clipboard_clear(); self.clipboard_append(text)

    def _copy_kw(self, pname, lang):
        p = self.platforms[pname]
        key = f"kw_{lang}_entries"
        words = [e.get().strip() for e in p[key] if e.get().strip()]
        self._copy(", ".join(words))
        self._status(f"✅  {len(words)} {lang.upper()} keyword kopyalandı")

    def _apply_istock(self):
        d = load_istock()
        for e in self.platforms["iStock"]["kw_en_entries"]:
            k = e.get().strip().lower()
            if k in d: e.delete(0,"end"); e.insert(0,d[k])
        self._status("✅  iStock eşleştirmesi uygulandı")

    def _se(self, w, t):
        w.delete(0,"end"); w.insert(0,t)

    def _stb(self, w, t):
        w.delete("1.0","end"); w.insert("1.0",t)

    def _status(self, msg):
        self.after(0, lambda: self.title(f"Stock Metadata  —  {msg}"))

    # ══════════════════════════════════════════════════════════════════════════
    #  DİYALOGLAR
    # ══════════════════════════════════════════════════════════════════════════
    def _dlg_settings(self):
        win = ctk.CTkToplevel(self); win.title("Ayarlar")
        win.geometry("500x260"); win.configure(fg_color=CARD)
        win.grab_set(); win.lift(); win.focus_force()

        ctk.CTkLabel(win, text="API Ayarları",
                     font=ctk.CTkFont("Helvetica",15,"bold"),
                     text_color=TEXT).pack(pady=(18,12))

        entries = {}
        for label, key, hide in [
            ("Groq API Key","groq_api_key",True),
            ("Everypixels Client ID","everypixels_id",False),
            ("Everypixels Client Secret","everypixels_secret",True),
        ]:
            f = ctk.CTkFrame(win, fg_color="transparent")
            f.pack(fill="x", padx=30, pady=4)
            ctk.CTkLabel(f, text=label, width=210, anchor="w",
                         text_color=TEXT2).pack(side="left")
            e = ctk.CTkEntry(f, show="●" if hide else "",
                              corner_radius=8, height=32,
                              fg_color=INPUT, border_color=BORDER,
                              text_color=TEXT)
            e.pack(side="left", fill="x", expand=True)
            e.insert(0, self.settings.get(key,""))
            entries[key] = e

        def do_save():
            for k,e in entries.items(): self.settings[k]=e.get().strip()
            save_settings(self.settings); win.destroy()

        ctk.CTkButton(win, text="💾  Kaydet", height=36, corner_radius=10,
                       fg_color=ACCENT, hover_color=ACCENT_H,
                       command=do_save).pack(fill="x", padx=30, pady=14)

    def _dlg_istock(self):
        win = ctk.CTkToplevel(self); win.title("iStock Keyword Kütüphanesi")
        win.geometry("640,520"); win.geometry("640x520")
        win.configure(fg_color=CARD); win.grab_set()
        win.lift(); win.focus_force()

        ctk.CTkLabel(win, text="iStock Keyword Eşleştirme",
                     font=ctk.CTkFont("Helvetica",14,"bold"),
                     text_color=TEXT).pack(pady=(14,2))

        add_f = ctk.CTkFrame(win, fg_color=CARD2, corner_radius=10)
        add_f.pack(fill="x", padx=16, pady=8)

        g_e = ctk.CTkEntry(add_f, width=160, corner_radius=8, height=32,
                            placeholder_text="Genel kelime",
                            fg_color=INPUT, border_color=BORDER, text_color=TEXT)
        g_e.pack(side="left", padx=10, pady=10)
        ctk.CTkLabel(add_f, text="→", text_color=TEXT2).pack(side="left")
        i_e = ctk.CTkEntry(add_f, width=200, corner_radius=8, height=32,
                            placeholder_text="iStock karşılığı",
                            fg_color=INPUT, border_color=BORDER, text_color=TEXT)
        i_e.pack(side="left", padx=10, pady=10)

        sf = ctk.CTkScrollableFrame(win, fg_color="transparent")
        sf.pack(fill="both", expand=True, padx=16, pady=4)

        def rebuild():
            for w in sf.winfo_children(): w.destroy()
            for gen,ist in sorted(load_istock().items()):
                row = ctk.CTkFrame(sf, fg_color=CARD2, corner_radius=8)
                row.pack(fill="x", pady=2)
                ctk.CTkLabel(row, text=gen, width=170, anchor="w",
                             text_color=TEXT2).pack(side="left", padx=10, pady=6)
                ctk.CTkLabel(row, text="→", text_color=TEXT3,
                             width=20).pack(side="left")
                ctk.CTkLabel(row, text=ist, width=200, anchor="w",
                             text_color="#5b9af8").pack(side="left", padx=8)
                def _del(g=gen):
                    d=load_istock(); d.pop(g.lower(),None)
                    save_istock(d); rebuild()
                ctk.CTkButton(row, text="✕", width=28, height=24,
                               corner_radius=6, fg_color="#3a0a0a",
                               hover_color="#5a1010", text_color="#ff6666",
                               command=_del).pack(side="right", padx=8)

        def _add():
            g,i=g_e.get().strip(),i_e.get().strip()
            if g and i:
                d=load_istock(); d[g.lower()]=i; save_istock(d)
                g_e.delete(0,"end"); i_e.delete(0,"end"); rebuild()

        ctk.CTkButton(add_f, text="+ Ekle", width=80, height=32,
                       corner_radius=8, fg_color=ACCENT, hover_color=ACCENT_H,
                       command=_add).pack(side="left", padx=8)
        rebuild()

    def _dlg_find(self):
        win = ctk.CTkToplevel(self); win.title("Bul & Değiştir")
        win.geometry("500x220"); win.configure(fg_color=CARD)
        win.grab_set(); win.lift(); win.focus_force()

        ctk.CTkLabel(win, text="Bul & Değiştir",
                     font=ctk.CTkFont("Helvetica",14,"bold"),
                     text_color=TEXT).pack(pady=(16,10))

        self._fv = ctk.StringVar()
        self._rv = ctk.StringVar()

        for lbl, var in [("Bul:",self._fv),("Değiştir:",self._rv)]:
            f = ctk.CTkFrame(win, fg_color="transparent")
            f.pack(fill="x", padx=30, pady=4)
            ctk.CTkLabel(f, text=lbl, width=80, anchor="w",
                         text_color=TEXT2).pack(side="left")
            ctk.CTkEntry(f, textvariable=var, corner_radius=8, height=32,
                          fg_color=INPUT, border_color=BORDER,
                          text_color=TEXT).pack(side="left",fill="x",expand=True)

        res = ctk.CTkLabel(win, text="", text_color=GREEN,
                            font=ctk.CTkFont("Helvetica",11))
        res.pack(pady=4)

        def do():
            find=self._fv.get().strip(); repl=self._rv.get().strip()
            if not find: return
            n=0
            def re_e(e):
                nonlocal n
                v=e.get(); nv=re.sub(re.escape(find),repl,v,flags=re.IGNORECASE)
                if nv!=v: e.delete(0,"end"); e.insert(0,nv); n+=1
            def re_t(t):
                nonlocal n
                v=t.get("1.0","end").strip()
                nv=re.sub(re.escape(find),repl,v,flags=re.IGNORECASE)
                if nv!=v: t.delete("1.0","end"); t.insert("1.0",nv); n+=1

            re_e(self.title_en); re_e(self.title_tr)
            re_t(self.desc_en);  re_t(self.desc_tr)
            for p in self.platforms.values():
                for e in p["kw_en_entries"]+p["kw_tr_entries"]: re_e(e)
            res.configure(text=f"✅  {n} alanda değiştirildi")

        ctk.CTkButton(win, text="🔄  Tümünü Değiştir", height=36,
                       corner_radius=10, fg_color=ACCENT, hover_color=ACCENT_H,
                       command=do).pack(fill="x", padx=30, pady=8)
        win.bind("<Return>", lambda e: do())


if __name__ == "__main__":
    app = App()
    app.bind("<Command-f>", lambda e: app._dlg_find())
    app.mainloop()

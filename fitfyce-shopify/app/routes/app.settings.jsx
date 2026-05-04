import PropTypes from "prop-types";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
} from "react-router";
import { useState, useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

// ─── Server ───────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
  const res = await api.getSettings();
  return { settings: res.ok ? res.data ?? null : null, shop: session.shop };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const body = await request.json();
  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
  const res = await api.saveSettings(body);
  return { ok: res.ok, error: res.error ?? null };
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const WORLD_LANGUAGES = [
  { value: "af", label: "Afrikaans", nativeName: "Afrikaans" },
  { value: "sq", label: "Albanian", nativeName: "Shqip" },
  { value: "am", label: "Amharic", nativeName: "አማርኛ" },
  { value: "ar", label: "Arabic", nativeName: "العربية" },
  { value: "hy", label: "Armenian", nativeName: "Հայերեն" },
  { value: "az", label: "Azerbaijani", nativeName: "Azərbaycan" },
  { value: "eu", label: "Basque", nativeName: "Euskara" },
  { value: "be", label: "Belarusian", nativeName: "Беларуская" },
  { value: "bn", label: "Bengali", nativeName: "বাংলা" },
  { value: "bs", label: "Bosnian", nativeName: "Bosanski" },
  { value: "bg", label: "Bulgarian", nativeName: "Български" },
  { value: "my", label: "Burmese", nativeName: "မြန်မာ" },
  { value: "ca", label: "Catalan", nativeName: "Català" },
  { value: "ceb", label: "Cebuano", nativeName: "Cebuano" },
  { value: "zh", label: "Chinese (Simplified)", nativeName: "中文(简体)" },
  { value: "zh-TW", label: "Chinese (Traditional)", nativeName: "中文(繁體)" },
  { value: "hr", label: "Croatian", nativeName: "Hrvatski" },
  { value: "cs", label: "Czech", nativeName: "Čeština" },
  { value: "da", label: "Danish", nativeName: "Dansk" },
  { value: "nl", label: "Dutch", nativeName: "Nederlands" },
  { value: "en", label: "English", nativeName: "English" },
  { value: "eo", label: "Esperanto", nativeName: "Esperanto" },
  { value: "et", label: "Estonian", nativeName: "Eesti" },
  { value: "fo", label: "Faroese", nativeName: "Føroyskt" },
  { value: "fi", label: "Finnish", nativeName: "Suomi" },
  { value: "fr", label: "French", nativeName: "Français" },
  { value: "fy", label: "Frisian", nativeName: "Frysk" },
  { value: "gl", label: "Galician", nativeName: "Galego" },
  { value: "ka", label: "Georgian", nativeName: "ქართული" },
  { value: "de", label: "German", nativeName: "Deutsch" },
  { value: "el", label: "Greek", nativeName: "Ελληνικά" },
  { value: "gu", label: "Gujarati", nativeName: "ગુજરાતી" },
  { value: "ht", label: "Haitian Creole", nativeName: "Kreyòl Ayisyen" },
  { value: "ha", label: "Hausa", nativeName: "Hausa" },
  { value: "haw", label: "Hawaiian", nativeName: "ʻŌlelo Hawaiʻi" },
  { value: "he", label: "Hebrew", nativeName: "עברית" },
  { value: "hi", label: "Hindi", nativeName: "हिन्दी" },
  { value: "hu", label: "Hungarian", nativeName: "Magyar" },
  { value: "is", label: "Icelandic", nativeName: "Íslenska" },
  { value: "ig", label: "Igbo", nativeName: "Igbo" },
  { value: "id", label: "Indonesian", nativeName: "Bahasa Indonesia" },
  { value: "ga", label: "Irish", nativeName: "Gaeilge" },
  { value: "it", label: "Italian", nativeName: "Italiano" },
  { value: "ja", label: "Japanese", nativeName: "日本語" },
  { value: "jv", label: "Javanese", nativeName: "Basa Jawa" },
  { value: "kn", label: "Kannada", nativeName: "ಕನ್ನಡ" },
  { value: "kk", label: "Kazakh", nativeName: "Қазақ" },
  { value: "km", label: "Khmer", nativeName: "ខ្មែរ" },
  { value: "rw", label: "Kinyarwanda", nativeName: "Ikinyarwanda" },
  { value: "ko", label: "Korean", nativeName: "한국어" },
  { value: "ku", label: "Kurdish", nativeName: "Kurdî" },
  { value: "ky", label: "Kyrgyz", nativeName: "Кыргызча" },
  { value: "lo", label: "Lao", nativeName: "ລາວ" },
  { value: "lv", label: "Latvian", nativeName: "Latviešu" },
  { value: "lt", label: "Lithuanian", nativeName: "Lietuvių" },
  { value: "lb", label: "Luxembourgish", nativeName: "Lëtzebuergesch" },
  { value: "mk", label: "Macedonian", nativeName: "Македонски" },
  { value: "mg", label: "Malagasy", nativeName: "Malagasy" },
  { value: "ms", label: "Malay", nativeName: "Bahasa Melayu" },
  { value: "ml", label: "Malayalam", nativeName: "മലയാളം" },
  { value: "mt", label: "Maltese", nativeName: "Malti" },
  { value: "mi", label: "Maori", nativeName: "Māori" },
  { value: "mr", label: "Marathi", nativeName: "मराठी" },
  { value: "mn", label: "Mongolian", nativeName: "Монгол" },
  { value: "ne", label: "Nepali", nativeName: "नेपाली" },
  { value: "no", label: "Norwegian", nativeName: "Norsk" },
  { value: "ny", label: "Nyanja (Chichewa)", nativeName: "Chichewa" },
  { value: "or", label: "Odia (Oriya)", nativeName: "ଓଡ଼ିଆ" },
  { value: "ps", label: "Pashto", nativeName: "پښتو" },
  { value: "fa", label: "Persian", nativeName: "فارسی" },
  { value: "pl", label: "Polish", nativeName: "Polski" },
  { value: "pt", label: "Portuguese", nativeName: "Português" },
  { value: "pa", label: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { value: "ro", label: "Romanian", nativeName: "Română" },
  { value: "ru", label: "Russian", nativeName: "Русский" },
  { value: "sm", label: "Samoan", nativeName: "Samoa" },
  { value: "gd", label: "Scots Gaelic", nativeName: "Gàidhlig" },
  { value: "sr", label: "Serbian", nativeName: "Српски" },
  { value: "st", label: "Sesotho", nativeName: "Sesotho" },
  { value: "sn", label: "Shona", nativeName: "Shona" },
  { value: "sd", label: "Sindhi", nativeName: "سنڌي" },
  { value: "si", label: "Sinhala", nativeName: "සිංහල" },
  { value: "sk", label: "Slovak", nativeName: "Slovenčina" },
  { value: "sl", label: "Slovenian", nativeName: "Slovenščina" },
  { value: "so", label: "Somali", nativeName: "Soomaali" },
  { value: "es", label: "Spanish", nativeName: "Español" },
  { value: "su", label: "Sundanese", nativeName: "Basa Sunda" },
  { value: "sw", label: "Swahili", nativeName: "Kiswahili" },
  { value: "sv", label: "Swedish", nativeName: "Svenska" },
  { value: "tl", label: "Tagalog (Filipino)", nativeName: "Tagalog" },
  { value: "tg", label: "Tajik", nativeName: "Тоҷикӣ" },
  { value: "ta", label: "Tamil", nativeName: "தமிழ்" },
  { value: "tt", label: "Tatar", nativeName: "Татар" },
  { value: "te", label: "Telugu", nativeName: "తెలుగు" },
  { value: "th", label: "Thai", nativeName: "ไทย" },
  { value: "tr", label: "Turkish", nativeName: "Türkçe" },
  { value: "tk", label: "Turkmen", nativeName: "Türkmen" },
  { value: "uk", label: "Ukrainian", nativeName: "Українська" },
  { value: "ur", label: "Urdu", nativeName: "اردو" },
  { value: "ug", label: "Uyghur", nativeName: "ئۇيغۇرچە" },
  { value: "uz", label: "Uzbek", nativeName: "O'zbek" },
  { value: "vi", label: "Vietnamese", nativeName: "Tiếng Việt" },
  { value: "cy", label: "Welsh", nativeName: "Cymraeg" },
  { value: "xh", label: "Xhosa", nativeName: "isiXhosa" },
  { value: "yi", label: "Yiddish", nativeName: "יידיש" },
  { value: "yo", label: "Yoruba", nativeName: "Yorùbá" },
  { value: "zu", label: "Zulu", nativeName: "isiZulu" },
];

const BUTTON_TRANSLATIONS = {
  en: { title: "Try On This Look", subtitle: "See how it fits before you buy" },
  af: { title: "Probeer hierdie voorkoms", subtitle: "Sien hoe dit pas voor jy koop" },
  am: { title: "ይህን ቅርጽ ሞክር", subtitle: "ከመግዛትዎ በፊት እንዴት እንደሚስማማ ይመልከቱ" },
  ar: { title: "جرب هذا المظهر", subtitle: "شاهد كيف يناسبك قبل الشراء" },
  hy: { title: "Փորձել այս տեսքը", subtitle: "Տեսեք, թե ինչպես է տեղավորվում գնելուց առաջ" },
  az: { title: "Bu görünüşü sınayın", subtitle: "Almadan əvvəl necə uyğun olduğunu görün" },
  eu: { title: "Proba ezazu itxura hau", subtitle: "Ikusi nola egokitzen den erosi aurretik" },
  be: { title: "Прымераць гэты выгляд", subtitle: "Паглядзіце, як падыходзіць, перш чым купіць" },
  bn: { title: "এই লুক ট্রাই করুন", subtitle: "কেনার আগে কেমন মানায় দেখুন" },
  bs: { title: "Isprobajte ovaj izgled", subtitle: "Pogledajte kako pristaje prije kupovine" },
  bg: { title: "Опитайте този вид", subtitle: "Вижте как стои преди да купите" },
  my: { title: "ဒီပုံစံကို စမ်းကြည့်ပါ", subtitle: "ဝယ်မနေမီ ဘယ်လိုကြည့်ကောင်းလဲ ကြည့်ပါ" },
  ca: { title: "Prova aquest look", subtitle: "Mira com t'escau abans de comprar" },
  zh: { title: "试穿这套搭配", subtitle: "购买前查看合身效果" },
  "zh-TW": { title: "試穿這套搭配", subtitle: "購買前查看合身效果" },
  hr: { title: "Isprobajte ovaj izgled", subtitle: "Pogledajte kako pristaje prije kupnje" },
  cs: { title: "Vyzkoušejte tento look", subtitle: "Uvidíte, jak to sedí, než koupíte" },
  da: { title: "Prøv dette look", subtitle: "Se hvordan det passer, før du køber" },
  nl: { title: "Probeer deze look", subtitle: "Bekijk hoe het past voordat u koopt" },
  eo: { title: "Provu ĉi tiun aspekton", subtitle: "Vidu kiel ĝi konvenas antaŭ ol aĉeti" },
  et: { title: "Proovige seda välimust", subtitle: "Vaadake, kuidas sobib, enne ostmist" },
  fi: { title: "Kokeile tätä lookkia", subtitle: "Katso miten se sopii ennen ostoa" },
  fr: { title: "Essayez ce look", subtitle: "Voyez comment ça vous va avant d'acheter" },
  gl: { title: "Proba este look", subtitle: "Mira como che queda antes de mercar" },
  ka: { title: "სცადეთ ეს სახე", subtitle: "ნახეთ, როგორ ჯდება ყიდვამდე" },
  de: { title: "Diesen Look anprobieren", subtitle: "Sehen Sie, wie es passt, bevor Sie kaufen" },
  el: { title: "Δοκιμάστε αυτή την εμφάνιση", subtitle: "Δείτε πώς σας ταιριάζει πριν αγοράσετε" },
  gu: { title: "આ લૂક ટ્રાય કરો", subtitle: "ખરીદતા પહેલા કેવી રીતે ફિટ થાય છે તે જુઓ" },
  ha: { title: "Gwada wannan salo", subtitle: "Duba yadda ya dace kafin ka saya" },
  he: { title: "נסה את המראה הזה", subtitle: "ראה איך זה מתאים לפני הקנייה" },
  hi: { title: "इसे ट्राय करें", subtitle: "खरीदने से पहले देखें कैसा लगता है" },
  hu: { title: "Próbálja fel ezt a stílust", subtitle: "Nézze meg, hogyan áll, mielőtt megveszi" },
  is: { title: "Prófaðu þetta útlit", subtitle: "Sjáðu hvernig það passar áður en þú kaupir" },
  id: { title: "Coba tampilan ini", subtitle: "Lihat bagaimana cocoknya sebelum membeli" },
  ga: { title: "Bain triail as an gcuma seo", subtitle: "Féach conas a oireann sé sula gceannaíonn tú" },
  it: { title: "Prova questo look", subtitle: "Guarda come ti sta prima di acquistare" },
  ja: { title: "このコーデを試着", subtitle: "購入前にフィット感を確認" },
  kn: { title: "ಈ ಲುಕ್ ಪ್ರಯತ್ನಿಸಿ", subtitle: "ಖರೀದಿಸುವ ಮೊದಲು ಹೇಗೆ ಹೊಂದುತ್ತದೆ ನೋಡಿ" },
  kk: { title: "Бұл сыртқы келбетті сынап көріңіз", subtitle: "Сатып алмас бұрын қалай сәйкес келетінін көріңіз" },
  km: { title: "សាកល្បងរូបរាងនេះ", subtitle: "មើលថាតើវាសមប្រកបយ៉ាងណាមុននឹងទិញ" },
  ko: { title: "이 룩 착용해보기", subtitle: "구매 전 핏 확인하기" },
  ky: { title: "Бул сырт кийимди сынап көрүңүз", subtitle: "Сатып алардан мурун кантип отурарын көрүңүз" },
  lo: { title: "ລອງສວມໃສ່ຮູບລັກ", subtitle: "ເບິ່ງວ່າມັນເໝາະສົມກ່ອນຊື້" },
  lv: { title: "Izmēģiniet šo izskatu", subtitle: "Skatiet, kā der, pirms pirkšanas" },
  lt: { title: "Išbandykite šį stilių", subtitle: "Pamatykite, kaip tinka, prieš perkant" },
  mk: { title: "Пробајте го овој изглед", subtitle: "Видете kako одговара пред да купите" },
  ms: { title: "Cuba penampilan ini", subtitle: "Lihat bagaimana ia sesuai sebelum membeli" },
  ml: { title: "ഈ ലുക്ക് ട്രൈ ചെയ്യൂ", subtitle: "വാങ്ങുന്നതിന് മുമ്പ് എങ്ങനെ ഫിറ്റ് ആകുന്നുവെന്ന് കാണൂ" },
  mt: { title: "Ipprova dan il-look", subtitle: "Ara kif jaqbel qabel ma tixtri" },
  mr: { title: "हा लुक ट्राय करा", subtitle: "विकत घेण्यापूर्वी कसा दिसतो ते पहा" },
  mn: { title: "Энэ дүр төрхийг туршаад үзээрэй", subtitle: "Худалдан авахаасаа өмнө хэрхэн тохирохыг харна уу" },
  ne: { title: "यो लुक ट्राई गर्नुहोस्", subtitle: "किन्नु अघि कस्तो फिट हुन्छ हेर्नुहोस्" },
  no: { title: "Prøv dette utseendet", subtitle: "Se hvordan det passer før du kjøper" },
  ps: { title: "دا ډول هڅه وکړئ", subtitle: "د پیرودلو دمخه وګورئ چې څنګه برابره ده" },
  fa: { title: "این استایل را امتحان کنید", subtitle: "قبل از خرید ببینید چطور می‌شود" },
  pl: { title: "Przymierz ten wygląd", subtitle: "Sprawdź, jak pasuje, przed zakupem" },
  pt: { title: "Experimente este look", subtitle: "Veja como fica antes de comprar" },
  pa: { title: "ਇਸ ਲੁਕ ਨੂੰ ਅਜ਼ਮਾਓ", subtitle: "ਖਰੀਦਣ ਤੋਂ ਪਹਿਲਾਂ ਦੇਖੋ ਕਿਵੇਂ ਫਿੱਟ ਹੁੰਦਾ ਹੈ" },
  ro: { title: "Încearcă acest look", subtitle: "Vezi cum ți se potrivește înainte de a cumpăra" },
  ru: { title: "Примерить этот образ", subtitle: "Посмотрите, как сидит, прежде чем купить" },
  gd: { title: "Feuch an coltas seo", subtitle: "Faic ciamar a tha e a' freagairt mus ceannaich thu" },
  sr: { title: "Испробајте овај изглед", subtitle: "Погледајте kako стоји пре куповине" },
  si: { title: "මෙම ස්වරූපය ෆිට් කරන්න", subtitle: "මිලදී ගැනීමට පෙර ගැළපෙන ආකාරය බලන්න" },
  sk: { title: "Vyskúšajte tento look", subtitle: "Uvidíte, ako sedí, pred kúpou" },
  sl: { title: "Preizkusite ta videz", subtitle: "Preverite, kako leži, preden kupite" },
  so: { title: "Tijaabi muuqaalkan", subtitle: "Arag sida u haboon ka hor intaadan iibsan" },
  es: { title: "Pruébate este look", subtitle: "Ve cómo te queda antes de comprar" },
  sw: { title: "Jaribu muonekano huu", subtitle: "Angalia jinsi inavyofaa kabla ya kununua" },
  sv: { title: "Prova det här utseendet", subtitle: "Se hur det passar innan du köper" },
  tl: { title: "Subukan ang hitsura na ito", subtitle: "Tingnan kung paano magkasya bago bumili" },
  ta: { title: "இதை முயற்சிக்கவும்", subtitle: "வாங்குவதற்கு முன் பொருத்தத்தை பாருங்கள்" },
  te: { title: "ఈ లుక్ ట్రై చేయండి", subtitle: "కొనడానికి ముందు ఎలా ఫిట్ అవుతుందో చూడండి" },
  th: { title: "ลองสวมใส่ดูสิ", subtitle: "ดูว่าเหมาะกับคุณก่อนซื้อ" },
  tr: { title: "Bu görünümü dene", subtitle: "Satın almadan önce nasıl durduğunu gör" },
  uk: { title: "Приміряти цей образ", subtitle: "Подивіться, як сидить, перед покупкою" },
  ur: { title: "یہ لُک آزمائیں", subtitle: "خریدنے سے پہلے فٹ دیکھیں" },
  uz: { title: "Bu ko'rinishni sinab ko'ring", subtitle: "Sotib olishdan oldin qanday turishi ko'ring" },
  vi: { title: "Thử trang phục này", subtitle: "Xem cách nó phù hợp trước khi mua" },
  cy: { title: "Rhowch gynnig ar y golwg hwn", subtitle: "Gweler sut mae'n ffitio cyn prynu" },
  yi: { title: "פּרוּווט אָן דעם לוק", subtitle: "זעט ווי עס פּאַסט פֿאַר איר קויפֿן" },
  yo: { title: "Gbiyanju irisi yii", subtitle: "Wo bii o ṣe baamu ṣaaju ki o to ra" },
  zu: { title: "Zama lesi simo", subtitle: "Bona ukuthi ihlangana kanjani ngaphambi kokuthenga" },
};

const FONT_WEIGHT_OPTIONS = [
  { label: "Light (300)", value: "300" },
  { label: "Regular (400)", value: "400" },
  { label: "Medium (500)", value: "500" },
  { label: "Semibold (600)", value: "600" },
  { label: "Bold (700)", value: "700" },
];

const FONT_FAMILY_OPTIONS = [
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Roboto", value: "Roboto, sans-serif" },
  { label: "Poppins", value: "Poppins, sans-serif" },
  { label: "Open Sans", value: "'Open Sans', sans-serif" },
  { label: "Georgia (Serif)", value: "Georgia, serif" },
];

// ─── Primitives ───────────────────────────────────────────────────────────────

function SectionCard({ title, description, children }) {
  return (
    <div className="vto-card" style={{ padding: 0, overflow: "hidden", marginBottom: "24px" }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--vto-border)" }}>
        <h3 className="vto-title" style={{ fontSize: "1rem" }}>{title}</h3>
        {description && (
          <p className="vto-subtitle" style={{ fontSize: "0.85rem", marginTop: "4px" }}>{description}</p>
        )}
      </div>
      <div style={{ padding: "24px" }}>{children}</div>
    </div>
  );
}
SectionCard.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  children: PropTypes.node,
};

function PositionCard({ id, label, sub, icon, active, onClick }) {
  const icons = {
    monitor: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    cart: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  };

  return (
    <div
      onClick={() => onClick(id)}
      className={`vto-card cursor-pointer transition-all duration-200 border-2 ${active ? "border-blue-600 bg-blue-50" : "border-transparent"}`}
      style={{ padding: "16px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
    >
      <div className={`p-3 rounded-lg mb-3 ${active ? "text-blue-600" : "text-gray-400"}`}>
        {icons[icon] ?? null}
      </div>
      <p className={`text-sm font-bold ${active ? "text-blue-700" : "text-gray-900"}`}>{label}</p>
      <p className="text-[9px] text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}
PositionCard.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  sub: PropTypes.string,
  icon: PropTypes.string,
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
};

function IconPicker({ value, onChange }) {
  const icons = ["none", "eye", "sparkles", "camera", "shopping-bag"];
  return (
    <div className="flex gap-2.5">
      {icons.map((icon) => (
        <button
          key={icon}
          type="button"
          onClick={() => onChange(icon)}
          className={`flex-1 aspect-square max-w-[56px] rounded-xl flex items-center justify-center border-2 transition-all ${
            value === icon
              ? "border-blue-600 bg-blue-50 text-blue-600"
              : "border-gray-100 bg-white text-gray-400 hover:border-gray-200 hover:text-gray-600"
          }`}
        >
          {icon === "none" ? (
            <span className="text-[9px] font-bold">NONE</span>
          ) : (
            <>
              {icon === "eye" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
              {icon === "sparkles" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z" />
                </svg>
              )}
              {icon === "camera" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              )}
              {icon === "shopping-bag" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              )}
            </>
          )}
        </button>
      ))}
    </div>
  );
}
IconPicker.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

function FormInput({ label, value, onChange, placeholder, name }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-bold text-gray-900">{label}</label>
      <input
        type="text"
        name={name || `vto_${label.toLowerCase().replace(/\s+/g, "_")}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="chrome-off"
        className="w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all"
      />
    </div>
  );
}
FormInput.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  name: PropTypes.string,
};

function ColorPicker({ label, value, onChange }) {
  const isValid = /^#[0-9A-Fa-f]{6}$/.test(value);
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-bold text-gray-900">{label}</label>
      <div className="flex items-center gap-2.5">
        <label
          className="flex-shrink-0 w-12 h-12 rounded-xl border-2 border-gray-100 cursor-pointer relative shadow-sm overflow-hidden"
          style={{ background: isValid ? value : "#ccc" }}
        >
          <input
            type="color"
            value={isValid ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </label>
        <input
          type="text"
          name={`vto_color_${label.toLowerCase().replace(/\s+/g, "_")}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#111827"
          maxLength={7}
          autoComplete="chrome-off"
          className="flex-1 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl px-4 py-3 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all"
        />
      </div>
    </div>
  );
}
ColorPicker.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

function NumberInput({ label, value, onChange, min, max, suffix = "px" }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <label className="text-sm font-bold text-gray-900">{label}</label>
        {suffix && <span className="text-[10px] font-bold text-gray-400">{suffix}</span>}
      </div>
      <input
        type="number"
        min={min}
        max={max}
        autoComplete="chrome-off"
        className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-semibold bg-white"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
      />
    </div>
  );
}
NumberInput.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  suffix: PropTypes.string,
};

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-bold text-gray-900">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all pr-10 font-medium"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
    </div>
  );
}
SelectField.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({ label: PropTypes.string.isRequired, value: PropTypes.string.isRequired })
  ).isRequired,
};

function SearchableSelect({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (
        inputRef.current && !inputRef.current.closest("[data-lang-select]").contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const openDropdown = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setOpen(true);
    setQuery("");
  };

  const selected = options.find((o) => o.value === value);

  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.nativeName && o.nativeName.toLowerCase().includes(query.toLowerCase()))
      )
    : options;

  return (
    <div className="space-y-1.5" data-lang-select="">
      <label className="block text-sm font-bold text-gray-900">{label}</label>

      {/* Trigger button */}
      <button
        ref={inputRef}
        type="button"
        onClick={openDropdown}
        className="w-full flex items-center justify-between px-4 py-3 text-sm border border-gray-200 rounded-xl bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all text-left"
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-gray-900 truncate">{selected.label}</span>
            {selected.nativeName && selected.nativeName !== selected.label && (
              <span className="text-xs text-gray-400 flex-shrink-0">{selected.nativeName}</span>
            )}
          </span>
        ) : (
          <span className="text-gray-400">Select a language…</span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94A3B8"
          strokeWidth="2.5"
          className={`flex-shrink-0 ml-2 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Fixed-position dropdown — escapes overflow:hidden parents */}
      {open && (
        <div
          ref={dropRef}
          style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            zIndex: 9999,
          }}
          className="bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Search input */}
          <div className="p-2 border-b border-gray-100 bg-gray-50">
            <div className="relative">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9CA3AF"
                strokeWidth="2"
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="Search languages…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all"
              />
            </div>
          </div>

          {/* Scrollable list */}
          <div
            style={{ maxHeight: "260px", overflowY: "auto" }}
          >
            {filtered.length > 0 ? (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(opt.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-3 transition-colors ${
                    value === opt.value
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className={`flex-1 min-w-0 ${value === opt.value ? "font-semibold" : ""}`}>
                    {opt.label}
                  </span>
                  {opt.nativeName && opt.nativeName !== opt.label && (
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{opt.nativeName}</span>
                  )}
                  {value === opt.value && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="flex-shrink-0 text-blue-600">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm text-gray-400">No languages match &quot;{query}&quot;</p>
              </div>
            )}
          </div>

          {/* Footer count */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">
              {filtered.length} of {options.length} languages
            </span>
            {query && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setQuery(""); }}
                className="text-[11px] text-blue-600 font-medium hover:text-blue-700"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
SearchableSelect.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
      nativeName: PropTypes.string,
    })
  ).isRequired,
};

function Toggle({ checked, onChange, label, description, badge }) {
  return (
    <div className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
      <div className="flex-1 pr-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold text-gray-900">{label}</p>
          {badge && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">
              {badge}
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-gray-900/20 rounded-full"
        style={{ width: "44px", height: "24px" }}
      >
        <span
          className="absolute inset-0 rounded-full transition-colors duration-200"
          style={{ background: checked ? "#111827" : "#D1D5DB" }}
        />
        <span
          className="absolute top-[2px] w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-200"
          style={{ left: checked ? "22px" : "2px" }}
        />
      </button>
    </div>
  );
}
Toggle.propTypes = {
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
  description: PropTypes.string,
  badge: PropTypes.string,
};

function Divider() {
  return <div className="border-t border-gray-100" />;
}

// Four-value spacing control (top / right / bottom / left)
function SpacingInput({ label, values, onChange, suffix = "px" }) {
  const sides = ["top", "right", "bottom", "left"];
  return (
    <div className="space-y-2">
      <label className="block text-sm font-bold text-gray-900">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {sides.map((side) => (
          <div key={side} className="space-y-1">
            <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              {side}
            </span>
            <div className="relative">
              <input
                type="number"
                value={values[side]}
                min={0}
                max={200}
                onChange={(e) =>
                  onChange({ ...values, [side]: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 pr-8 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-semibold bg-white"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 pointer-events-none">
                {suffix}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
SpacingInput.propTypes = {
  label: PropTypes.string.isRequired,
  values: PropTypes.shape({
    top: PropTypes.number.isRequired,
    right: PropTypes.number.isRequired,
    bottom: PropTypes.number.isRequired,
    left: PropTypes.number.isRequired,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  suffix: PropTypes.string,
};

// ─── Live Preview Panel ───────────────────────────────────────────────────────

function LivePreview({
  buttonColor,
  buttonTextColor,
  widgetTitle,
  widgetSubtitle,
  titleFontSize,
  subtitleFontSize,
  subtitleFontFamily,
  titleFontFamily,
  titleFontWeight,
  borderRadius,
  buttonIcon,
  iconColor,
  mainIconBgColor,
  collIconBgColor,
  iconSize,
  iconRadius,
  collectionPosition,
  showOnCollection,
  buttonWidth,
  buttonHeight,
  buttonPadding,
  buttonMargin,
}) {
  const validColor = (c) => /^#[0-9A-Fa-f]{6}$/.test(c);

  const renderIcon = (isCollection = false) => {
    if (buttonIcon === "none") return null;
    const sz = isCollection ? iconSize * 0.8 : iconSize + 12;
    const svgSz = isCollection ? iconSize * 0.6 : iconSize;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isCollection ? collIconBgColor : mainIconBgColor,
          color: iconColor,
          width: `${sz}px`,
          height: `${sz}px`,
          borderRadius: `${iconRadius}px`,
          marginRight: isCollection ? "0" : "8px",
          flexShrink: 0,
        }}
      >
        {buttonIcon === "eye" && (
          <svg width={svgSz} height={svgSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
        {buttonIcon === "sparkles" && (
          <svg width={svgSz} height={svgSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z" />
          </svg>
        )}
        {buttonIcon === "camera" && (
          <svg width={svgSz} height={svgSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}
        {buttonIcon === "shopping-bag" && (
          <svg width={svgSz} height={svgSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        )}
      </div>
    );
  };

  const btnBg = validColor(buttonColor) ? buttonColor : "#111827";
  const btnTxt = validColor(buttonTextColor) ? buttonTextColor : "#ffffff";

  const collBtnStyle = {
    background: `${btnBg}dd`,
    color: btnTxt,
    borderRadius: `${borderRadius}px`,
  };

  const hasIcon = buttonIcon && buttonIcon !== "none";
  const mainBtnStyle = {
    background: btnBg,
    color: btnTxt,
    borderRadius: `${borderRadius}px`,
    width: buttonWidth > 0 ? `${buttonWidth}px` : "100%",
    height: buttonHeight > 0 ? `${buttonHeight}px` : "auto",
    paddingTop: `${buttonPadding.top}px`,
    paddingRight: `${buttonPadding.right}px`,
    paddingBottom: `${buttonPadding.bottom}px`,
    paddingLeft: `${buttonPadding.left}px`,
    marginTop: `${buttonMargin.top}px`,
    marginRight: `${buttonMargin.right}px`,
    marginBottom: `${buttonMargin.bottom}px`,
    marginLeft: `${buttonMargin.left}px`,
    display: "flex",
    flexDirection: hasIcon ? "row" : "column",
    alignItems: "center",
    justifyContent: "center",
    gap: hasIcon ? "8px" : "2px",
    transition: "all 0.2s",
    boxSizing: "border-box",
    overflow: "hidden",
  };

  const posClass = {
    top_left: "top-3 left-3",
    top_right: "top-3 right-3",
    bottom_left: "bottom-3 left-3",
    bottom_right: "bottom-3 right-3",
  }[collectionPosition] ?? "top-3 right-3";

  const isTop = collectionPosition?.startsWith("top");

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 h-full">
      <div className="relative h-60 bg-gray-100 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=1000"
          alt="Product Preview"
          className="w-full h-full object-cover"
        />
        {showOnCollection && (
          <div className={`absolute ${posClass}`}>
            <button
              className="flex items-center justify-center gap-1 shadow-lg backdrop-blur-sm transition-all"
              style={{
                ...collBtnStyle,
                padding: "6px 12px",
              }}
            >
              {renderIcon(true)}
              <span style={{ fontSize: "10px", fontWeight: "bold" }}>Try On</span>
            </button>
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Summer Dress</h2>
            <p className="text-sm text-gray-500">Premium Collection</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900">$89.00</p>
            <p className="text-[10px] text-gray-400 line-through">$120.00</p>
          </div>
        </div>

        <div className="space-y-3">

          <div style={{ display: "flex", justifyContent: buttonWidth > 0 ? "flex-start" : "stretch" }}>
            <button style={mainBtnStyle}>
              {hasIcon && renderIcon()}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                <span
                  style={{
                    fontSize: `${Math.max(titleFontSize * 0.7, 9)}px`,
                    fontWeight: titleFontWeight || "600",
                    fontFamily: titleFontFamily,
                    lineHeight: 1.2,
                  }}
                >
                  {widgetTitle || "Try On This Look"}
                </span>
                {widgetSubtitle && (
                  <span
                    style={{
                      fontSize: `${Math.max(subtitleFontSize * 0.7, 8)}px`,
                      opacity: 0.8,
                      fontFamily: subtitleFontFamily,
                      lineHeight: 1.2,
                    }}
                  >
                    {widgetSubtitle}
                  </span>
                )}
              </div>
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 py-3.5 flex items-center justify-center border-t border-gray-50">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">
          Powered by FitFyce
        </span>
      </div>
    </div>
  );
}
LivePreview.propTypes = {
  buttonColor: PropTypes.string,
  buttonTextColor: PropTypes.string,
  widgetTitle: PropTypes.string,
  widgetSubtitle: PropTypes.string,
  titleFontSize: PropTypes.number,
  subtitleFontSize: PropTypes.number,
  titleFontFamily: PropTypes.string,
  subtitleFontFamily: PropTypes.string,
  titleFontWeight: PropTypes.string,
  borderRadius: PropTypes.number,
  buttonIcon: PropTypes.string,
  iconColor: PropTypes.string,
  mainIconBgColor: PropTypes.string,
  collIconBgColor: PropTypes.string,
  iconSize: PropTypes.number,
  iconRadius: PropTypes.number,
  collectionPosition: PropTypes.string,
  showOnCollection: PropTypes.bool,
  buttonWidth: PropTypes.number,
  buttonHeight: PropTypes.number,
  buttonPadding: PropTypes.object,
  buttonMargin: PropTypes.object,
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ content, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-2xl">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {content}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100 transition-opacity">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
Toast.propTypes = {
  content: PropTypes.node.isRequired,
  onDismiss: PropTypes.func.isRequired,
};

// ─── Settings Page ────────────────────────────────────────────────────────────

export default function Settings() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";

  const [toastActive, setToastActive] = useState(false);
  const [activeTab, setActiveTab] = useState("button");

  // Button text
  const [widgetTitle, setWidgetTitle] = useState(settings?.widget_title ?? "Try On This Look");
  const [widgetSubtitle, setWidgetSubtitle] = useState(settings?.widget_subtitle ?? "See how it fits before you buy");

  // Button colors & shape
  const [buttonColor, setButtonColor] = useState(settings?.button_color ?? "#111827");
  const [buttonTextColor, setButtonTextColor] = useState(settings?.button_text_color ?? "#FFFFFF");
  const [borderRadius, setBorderRadius] = useState(settings?.button_border_radius ?? 8);
  const [hoverBg, setHoverBg] = useState(settings?.hover_bg_color ?? "#F3F4F6");

  // Button dimensions
  const [buttonWidth, setButtonWidth] = useState(settings?.button_width ?? 0);
  const [buttonHeight, setButtonHeight] = useState(settings?.button_height ?? 0);
  const [buttonPadding, setButtonPadding] = useState({
    top: settings?.button_padding_top ?? 10,
    right: settings?.button_padding_right ?? 24,
    bottom: settings?.button_padding_bottom ?? 10,
    left: settings?.button_padding_left ?? 24,
  });
  const [buttonMargin, setButtonMargin] = useState({
    top: settings?.button_margin_top ?? 0,
    right: settings?.button_margin_right ?? 0,
    bottom: settings?.button_margin_bottom ?? 0,
    left: settings?.button_margin_left ?? 0,
  });

  // Typography
  const [titleFontSize, setTitleFontSize] = useState(settings?.title_font_size ?? 20);
  const [subtitleFontSize, setSubtitleFontSize] = useState(settings?.subtitle_font_size ?? 14);
  const [titleFontWeight, setTitleFontWeight] = useState(settings?.title_font_weight ?? "600");
  const [titleFontFamily, setTitleFontFamily] = useState(settings?.title_font_family ?? "Inter, sans-serif");
  const [subtitleFontFamily, setSubtitleFontFamily] = useState(settings?.subtitle_font_family ?? "Inter, sans-serif");
  const [language, setLanguage] = useState(settings?.widget_language ?? "en");

  // Collection icon
  const [buttonIcon, setButtonIcon] = useState(settings?.button_icon ?? "eye");
  const [iconColor, setIconColor] = useState(settings?.icon_color ?? "#FFFFFF");
  const [mainIconBgColor, setMainIconBgColor] = useState(settings?.main_icon_bg_color ?? "transparent");
  const [collIconBgColor, setCollIconBgColor] = useState(settings?.coll_icon_bg_color ?? "transparent");
  const [iconSize, setIconSize] = useState(settings?.icon_size ?? 16);
  const [iconRadius, setIconRadius] = useState(settings?.icon_radius ?? 4);
  const [iconShape, setIconShape] = useState(settings?.icon_shape ?? "square");
  const [iconOpacity, setIconOpacity] = useState(settings?.icon_opacity ?? 100);
  const [showOnCollection, setShowOnCollection] = useState(Boolean(settings?.show_on_collection ?? true));
  const [collectionPosition, setCollectionPosition] = useState(settings?.collection_position ?? "top_right");

  // Features & compliance
  const [shareWa, setShareWa] = useState(Boolean(settings?.share_whatsapp_enabled ?? true));
  const [saveImg, setSaveImg] = useState(Boolean(settings?.save_image_enabled ?? true));
  const [privacy, setPrivacy] = useState(Boolean(settings?.privacy_notice_shown ?? true));

  const isFirstLangRender = useRef(true);
  useEffect(() => {
    if (isFirstLangRender.current) {
      isFirstLangRender.current = false;
      return;
    }
    const t = BUTTON_TRANSLATIONS[language] ?? BUTTON_TRANSLATIONS.en;
    setWidgetTitle(t.title);
    setWidgetSubtitle(t.subtitle);
  }, [language]);

  useEffect(() => {
    if (actionData?.ok) setToastActive(true);
  }, [actionData]);

  const handleSave = () => {
    submit(
      {
        widget_title: widgetTitle,
        widget_subtitle: widgetSubtitle,
        button_color: buttonColor,
        button_text_color: buttonTextColor,
        button_border_radius: borderRadius,
        hover_bg_color: hoverBg,
        button_width: buttonWidth,
        button_height: buttonHeight,
        button_padding_top: buttonPadding.top,
        button_padding_right: buttonPadding.right,
        button_padding_bottom: buttonPadding.bottom,
        button_padding_left: buttonPadding.left,
        button_margin_top: buttonMargin.top,
        button_margin_right: buttonMargin.right,
        button_margin_bottom: buttonMargin.bottom,
        button_margin_left: buttonMargin.left,
        title_font_size: titleFontSize,
        subtitle_font_size: subtitleFontSize,
        title_font_weight: titleFontWeight,
        title_font_family: titleFontFamily,
        subtitle_font_family: subtitleFontFamily,
        widget_language: language,
        button_icon: buttonIcon,
        icon_color: iconColor,
        main_icon_bg_color: mainIconBgColor,
        coll_icon_bg_color: collIconBgColor,
        icon_size: iconSize,
        icon_radius: iconRadius,
        icon_shape: iconShape,
        icon_opacity: iconOpacity,
        show_on_collection: showOnCollection,
        collection_position: collectionPosition,
        share_whatsapp_enabled: shareWa,
        save_image_enabled: saveImg,
        privacy_notice_shown: privacy,
      },
      { method: "post", encType: "application/json" }
    );
  };

  const TABS = [
    { id: "button", label: "Button Design" },
    { id: "typography", label: "Text & Style" },
    { id: "collection", label: "Collection Icon" },
    { id: "features", label: "Features" },
  ];

  return (
    <div className="min-h-screen bg-[#F6F6F7]">
      {toastActive && (
        <Toast content="Settings saved successfully!" onDismiss={() => setToastActive(false)} />
      )}

      {/* Page header */}
      <div
        style={{
          background: "white",
          borderBottom: "1px solid var(--vto-border)",
          padding: "16px 24px",
          position: "sticky",
          top: 0,
          zIndex: 40,
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h1 className="vto-title" style={{ fontSize: "1.25rem", marginBottom: "2px" }}>
              Button Settings &amp; Configuration
            </h1>
            <p className="text-[9px] text-gray-400 font-medium">
              Manage your button appearance, collection icons, and typography settings
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSubmitting}
            style={{ background: "#000000" }}
            className="text-white px-8 py-2.5 rounded-xl shadow-lg shadow-black/10 hover:shadow-black/20 active:scale-95 transition-all text-sm font-bold disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : "Save Configuration"}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">

          {/* LEFT: scrollable form */}
          <div className="space-y-6 min-w-0 pb-48">

            {/* Tab bar */}
            <div className="bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm flex gap-1 w-full">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                    activeTab === tab.id
                      ? "bg-gray-900 text-white shadow-md"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Button Design tab ── */}
            {activeTab === "button" && (
              <div className="space-y-6">
                <SectionCard title="Button Text" description="Configure the label and subtitle shown inside the button.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                    <FormInput
                      label="Button Title"
                      value={widgetTitle}
                      onChange={setWidgetTitle}
                      placeholder="Try On This Look"
                    />
                    <FormInput
                      label="Button Subtitle"
                      value={widgetSubtitle}
                      onChange={setWidgetSubtitle}
                      placeholder="See how it fits before you buy"
                    />
                  </div>
                </SectionCard>

                <SectionCard title="Colors & Shape" description="Button background, text color, and corner radius.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                    <ColorPicker label="Button Color" value={buttonColor} onChange={setButtonColor} />
                    <ColorPicker label="Button Text Color" value={buttonTextColor} onChange={setButtonTextColor} />
                    <ColorPicker label="Hover Background" value={hoverBg} onChange={setHoverBg} />
                    <NumberInput label="Border Radius" value={borderRadius} onChange={setBorderRadius} min={0} max={100} suffix="px" />
                  </div>
                </SectionCard>

                <SectionCard
                  title="Size & Dimensions"
                  description="Control button width and height. Set to 0 for automatic sizing."
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                    <NumberInput
                      label="Button Width"
                      value={buttonWidth}
                      onChange={setButtonWidth}
                      min={0}
                      max={800}
                      suffix="px"
                    />
                    <NumberInput
                      label="Button Height"
                      value={buttonHeight}
                      onChange={setButtonHeight}
                      min={0}
                      max={200}
                      suffix="px"
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  title="Padding"
                  description="Inner spacing between button text and its edges."
                >
                  <SpacingInput
                    label="Padding (Top / Right / Bottom / Left)"
                    values={buttonPadding}
                    onChange={setButtonPadding}
                    suffix="px"
                  />
                </SectionCard>

                <SectionCard
                  title="Margin"
                  description="Outer spacing around the button."
                >
                  <SpacingInput
                    label="Margin (Top / Right / Bottom / Left)"
                    values={buttonMargin}
                    onChange={setButtonMargin}
                    suffix="px"
                  />
                </SectionCard>
              </div>
            )}

            {/* ── Text & Style tab ── */}
            {activeTab === "typography" && (
              <div className="space-y-6">
                <SectionCard title="Typography" description="Control font sizes, weights and families.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                    <NumberInput label="Title Font Size" value={titleFontSize} onChange={setTitleFontSize} min={8} max={72} suffix="px" />
                    <NumberInput label="Subtitle Font Size" value={subtitleFontSize} onChange={setSubtitleFontSize} min={8} max={48} suffix="px" />
                    <SelectField label="Title Font Weight" value={titleFontWeight} onChange={setTitleFontWeight} options={FONT_WEIGHT_OPTIONS} />
                    <SelectField label="Title Font Family" value={titleFontFamily} onChange={setTitleFontFamily} options={FONT_FAMILY_OPTIONS} />
                    <SelectField label="Subtitle Font Family" value={subtitleFontFamily} onChange={setSubtitleFontFamily} options={FONT_FAMILY_OPTIONS} />
                  </div>
                </SectionCard>

                <SectionCard
                  title="Language"
                  description="Choose a language — the button text will update automatically in the preview and on your store."
                >
                  <SearchableSelect
                    label="Widget Language"
                    value={language}
                    onChange={setLanguage}
                    options={WORLD_LANGUAGES}
                  />
                </SectionCard>
              </div>
            )}

            {/* ── Collection Icon tab ── */}
            {activeTab === "collection" && (
              <SectionCard title="Collection Icon" description="Customize the VTO icon on product listing cards.">
                <Toggle
                  checked={showOnCollection}
                  onChange={setShowOnCollection}
                  label="Show on Collection Pages"
                  description="Enable the mini try-on icon for product listings."
                />

                {showOnCollection && (
                  <div className="space-y-8 mt-6 pt-6 border-t border-gray-100">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-4">
                        Position on Product Cards
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[
                          { id: "top_left", label: "Top Left", sub: "Over image", icon: "monitor" },
                          { id: "top_right", label: "Top Right", sub: "Over image", icon: "monitor" },
                          { id: "bottom_left", label: "Bottom Left", sub: "Action corner", icon: "cart" },
                          { id: "bottom_right", label: "Bottom Right", sub: "Action corner", icon: "cart" },
                        ].map((pos) => (
                          <PositionCard
                            key={pos.id}
                            id={pos.id}
                            label={pos.label}
                            sub={pos.sub}
                            icon={pos.icon}
                            active={collectionPosition === pos.id}
                            onClick={setCollectionPosition}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <label className="block text-sm font-bold text-gray-900">Icon Choice</label>
                        <IconPicker value={buttonIcon} onChange={setButtonIcon} />
                      </div>
                      <ColorPicker label="Icon Color" value={iconColor} onChange={setIconColor} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                      <ColorPicker label="Main Button Icon BG" value={mainIconBgColor} onChange={setMainIconBgColor} />
                      <ColorPicker label="Collection Icon BG" value={collIconBgColor} onChange={setCollIconBgColor} />
                      <NumberInput label="Icon Size" value={iconSize} onChange={setIconSize} min={8} max={48} />
                      <NumberInput label="Icon Border Radius" value={iconRadius} onChange={setIconRadius} min={0} max={32} />
                    </div>
                  </div>
                )}
              </SectionCard>
            )}

            {/* ── Features & Compliance tab ── */}
            {activeTab === "features" && (
              <SectionCard title="Features & Compliance" description="Enable or disable optional features and notices.">
                <Toggle
                  checked={shareWa}
                  onChange={setShareWa}
                  label="WhatsApp Share"
                  description="Allow customers to share their try-on results via WhatsApp."
                />
                <Divider />
                <Toggle
                  checked={saveImg}
                  onChange={setSaveImg}
                  label="Save Try-On Image"
                  badge="Active"
                  description="Allow customers to download the try-on photo."
                />
                <Divider />
                <Toggle
                  checked={privacy}
                  onChange={setPrivacy}
                  label="Privacy Notice"
                  badge="Active"
                  description="Show a consent notice before the customer uploads a photo."
                />
              </SectionCard>
            )}
          </div>

          {/* RIGHT: sticky live preview */}
          <div className="sticky top-[73px]">
            <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-widest mb-3 text-center">
              Live Preview
            </p>
            <LivePreview
              buttonColor={buttonColor}
              buttonTextColor={buttonTextColor}
              widgetTitle={widgetTitle}
              widgetSubtitle={widgetSubtitle}
              titleFontSize={titleFontSize}
              subtitleFontSize={subtitleFontSize}
              titleFontFamily={titleFontFamily}
              subtitleFontFamily={subtitleFontFamily}
              titleFontWeight={titleFontWeight}
              borderRadius={borderRadius}
              buttonIcon={buttonIcon}
              iconColor={iconColor}
              mainIconBgColor={mainIconBgColor}
              collIconBgColor={collIconBgColor}
              iconSize={iconSize}
              iconRadius={iconRadius}
              iconShape={iconShape}
              iconOpacity={iconOpacity}
              showOnCollection={showOnCollection}
              collectionPosition={collectionPosition}
              buttonWidth={buttonWidth}
              buttonHeight={buttonHeight}
              buttonPadding={buttonPadding}
              buttonMargin={buttonMargin}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

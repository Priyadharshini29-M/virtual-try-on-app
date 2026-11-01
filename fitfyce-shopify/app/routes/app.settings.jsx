import PropTypes from "prop-types";
import { useLoaderData, useFetcher } from "react-router";
import PlanGate from "../components/PlanGate";
import { useState, useEffect, useRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { useCelebrate } from "../components/AppShell";
import { FsPage, FsCard, FsButton, FsPill, FsEmpty, FsIcon } from "../components/fs-ui";
import { TOURS } from "../lib/tours";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";
import { PHP_API_URL } from "../lib/env.server";
import { phpPlanToUi } from "../lib/plans";

// ─── Server ───────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);
  const api = phpApiClient(apiKey, PHP_API_URL, session.shop);
  const [res, planRes] = await Promise.all([
    api.getSettings(),
    api.checkPlanLimit(),
  ]);
  return {
    settings: res.ok ? (res.data ?? null) : null,
    shop: session.shop,
    currentPlan: phpPlanToUi(planRes.ok ? (planRes.data?.plan ?? "basic") : "basic"),
  };
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
  af: {
    title: "Probeer hierdie voorkoms",
    subtitle: "Sien hoe dit pas voor jy koop",
  },
  am: { title: "ይህን ቅርጽ ሞክር", subtitle: "ከመግዛትዎ በፊት እንዴት እንደሚስማማ ይመልከቱ" },
  ar: { title: "جرب هذا المظهر", subtitle: "شاهد كيف يناسبك قبل الشراء" },
  hy: {
    title: "Փորձել այս տեսքը",
    subtitle: "Տեսեք, թե ինչպես է տեղավորվում գնելուց առաջ",
  },
  az: {
    title: "Bu görünüşü sınayın",
    subtitle: "Almadan əvvəl necə uyğun olduğunu görün",
  },
  eu: {
    title: "Proba ezazu itxura hau",
    subtitle: "Ikusi nola egokitzen den erosi aurretik",
  },
  be: {
    title: "Прымераць гэты выгляд",
    subtitle: "Паглядзіце, як падыходзіць, перш чым купіць",
  },
  bn: { title: "এই লুক ট্রাই করুন", subtitle: "কেনার আগে কেমন মানায় দেখুন" },
  bs: {
    title: "Isprobajte ovaj izgled",
    subtitle: "Pogledajte kako pristaje prije kupovine",
  },
  bg: {
    title: "Опитайте този вид",
    subtitle: "Вижте как стои преди да купите",
  },
  my: {
    title: "ဒီပုံစံကို စမ်းကြည့်ပါ",
    subtitle: "ဝယ်မနေမီ ဘယ်လိုကြည့်ကောင်းလဲ ကြည့်ပါ",
  },
  ca: {
    title: "Prova aquest look",
    subtitle: "Mira com t'escau abans de comprar",
  },
  zh: { title: "试穿这套搭配", subtitle: "购买前查看合身效果" },
  "zh-TW": { title: "試穿這套搭配", subtitle: "購買前查看合身效果" },
  hr: {
    title: "Isprobajte ovaj izgled",
    subtitle: "Pogledajte kako pristaje prije kupnje",
  },
  cs: {
    title: "Vyzkoušejte tento look",
    subtitle: "Uvidíte, jak to sedí, než koupíte",
  },
  da: {
    title: "Prøv dette look",
    subtitle: "Se hvordan det passer, før du køber",
  },
  nl: {
    title: "Probeer deze look",
    subtitle: "Bekijk hoe het past voordat u koopt",
  },
  eo: {
    title: "Provu ĉi tiun aspekton",
    subtitle: "Vidu kiel ĝi konvenas antaŭ ol aĉeti",
  },
  et: {
    title: "Proovige seda välimust",
    subtitle: "Vaadake, kuidas sobib, enne ostmist",
  },
  fi: {
    title: "Kokeile tätä lookkia",
    subtitle: "Katso miten se sopii ennen ostoa",
  },
  fr: {
    title: "Essayez ce look",
    subtitle: "Voyez comment ça vous va avant d'acheter",
  },
  gl: {
    title: "Proba este look",
    subtitle: "Mira como che queda antes de mercar",
  },
  ka: { title: "სცადეთ ეს სახე", subtitle: "ნახეთ, როგორ ჯდება ყიდვამდე" },
  de: {
    title: "Diesen Look anprobieren",
    subtitle: "Sehen Sie, wie es passt, bevor Sie kaufen",
  },
  el: {
    title: "Δοκιμάστε αυτή την εμφάνιση",
    subtitle: "Δείτε πώς σας ταιριάζει πριν αγοράσετε",
  },
  gu: {
    title: "આ લૂક ટ્રાય કરો",
    subtitle: "ખરીદતા પહેલા કેવી રીતે ફિટ થાય છે તે જુઓ",
  },
  ha: {
    title: "Gwada wannan salo",
    subtitle: "Duba yadda ya dace kafin ka saya",
  },
  he: { title: "נסה את המראה הזה", subtitle: "ראה איך זה מתאים לפני הקנייה" },
  hi: {
    title: "इसे ट्राय करें",
    subtitle: "खरीदने से पहले देखें कैसा लगता है",
  },
  hu: {
    title: "Próbálja fel ezt a stílust",
    subtitle: "Nézze meg, hogyan áll, mielőtt megveszi",
  },
  is: {
    title: "Prófaðu þetta útlit",
    subtitle: "Sjáðu hvernig það passar áður en þú kaupir",
  },
  id: {
    title: "Coba tampilan ini",
    subtitle: "Lihat bagaimana cocoknya sebelum membeli",
  },
  ga: {
    title: "Bain triail as an gcuma seo",
    subtitle: "Féach conas a oireann sé sula gceannaíonn tú",
  },
  it: {
    title: "Prova questo look",
    subtitle: "Guarda come ti sta prima di acquistare",
  },
  ja: { title: "このコーデを試着", subtitle: "購入前にフィット感を確認" },
  kn: {
    title: "ಈ ಲುಕ್ ಪ್ರಯತ್ನಿಸಿ",
    subtitle: "ಖರೀದಿಸುವ ಮೊದಲು ಹೇಗೆ ಹೊಂದುತ್ತದೆ ನೋಡಿ",
  },
  kk: {
    title: "Бұл сыртқы келбетті сынап көріңіз",
    subtitle: "Сатып алмас бұрын қалай сәйкес келетінін көріңіз",
  },
  km: {
    title: "សាកល្បងរូបរាងនេះ",
    subtitle: "មើលថាតើវាសមប្រកបយ៉ាងណាមុននឹងទិញ",
  },
  ko: { title: "이 룩 착용해보기", subtitle: "구매 전 핏 확인하기" },
  ky: {
    title: "Бул сырт кийимди сынап көрүңүз",
    subtitle: "Сатып алардан мурун кантип отурарын көрүңүз",
  },
  lo: { title: "ລອງສວມໃສ່ຮູບລັກ", subtitle: "ເບິ່ງວ່າມັນເໝາະສົມກ່ອນຊື້" },
  lv: {
    title: "Izmēģiniet šo izskatu",
    subtitle: "Skatiet, kā der, pirms pirkšanas",
  },
  lt: {
    title: "Išbandykite šį stilių",
    subtitle: "Pamatykite, kaip tinka, prieš perkant",
  },
  mk: {
    title: "Пробајте го овој изглед",
    subtitle: "Видете kako одговара пред да купите",
  },
  ms: {
    title: "Cuba penampilan ini",
    subtitle: "Lihat bagaimana ia sesuai sebelum membeli",
  },
  ml: {
    title: "ഈ ലുക്ക് ട്രൈ ചെയ്യൂ",
    subtitle: "വാങ്ങുന്നതിന് മുമ്പ് എങ്ങനെ ഫിറ്റ് ആകുന്നുവെന്ന് കാണൂ",
  },
  mt: {
    title: "Ipprova dan il-look",
    subtitle: "Ara kif jaqbel qabel ma tixtri",
  },
  mr: {
    title: "हा लुक ट्राय करा",
    subtitle: "विकत घेण्यापूर्वी कसा दिसतो ते पहा",
  },
  mn: {
    title: "Энэ дүр төрхийг туршаад үзээрэй",
    subtitle: "Худалдан авахаасаа өмнө хэрхэн тохирохыг харна уу",
  },
  ne: {
    title: "यो लुक ट्राई गर्नुहोस्",
    subtitle: "किन्नु अघि कस्तो फिट हुन्छ हेर्नुहोस्",
  },
  no: {
    title: "Prøv dette utseendet",
    subtitle: "Se hvordan det passer før du kjøper",
  },
  ps: {
    title: "دا ډول هڅه وکړئ",
    subtitle: "د پیرودلو دمخه وګورئ چې څنګه برابره ده",
  },
  fa: {
    title: "این استایل را امتحان کنید",
    subtitle: "قبل از خرید ببینید چطور می‌شود",
  },
  pl: {
    title: "Przymierz ten wygląd",
    subtitle: "Sprawdź, jak pasuje, przed zakupem",
  },
  pt: {
    title: "Experimente este look",
    subtitle: "Veja como fica antes de comprar",
  },
  pa: {
    title: "ਇਸ ਲੁਕ ਨੂੰ ਅਜ਼ਮਾਓ",
    subtitle: "ਖਰੀਦਣ ਤੋਂ ਪਹਿਲਾਂ ਦੇਖੋ ਕਿਵੇਂ ਫਿੱਟ ਹੁੰਦਾ ਹੈ",
  },
  ro: {
    title: "Încearcă acest look",
    subtitle: "Vezi cum ți se potrivește înainte de a cumpăra",
  },
  ru: {
    title: "Примерить этот образ",
    subtitle: "Посмотрите, как сидит, прежде чем купить",
  },
  gd: {
    title: "Feuch an coltas seo",
    subtitle: "Faic ciamar a tha e a' freagairt mus ceannaich thu",
  },
  sr: {
    title: "Испробајте овај изглед",
    subtitle: "Погледајте kako стоји пре куповине",
  },
  si: {
    title: "මෙම ස්වරූපය ෆිට් කරන්න",
    subtitle: "මිලදී ගැනීමට පෙර ගැළපෙන ආකාරය බලන්න",
  },
  sk: {
    title: "Vyskúšajte tento look",
    subtitle: "Uvidíte, ako sedí, pred kúpou",
  },
  sl: {
    title: "Preizkusite ta videz",
    subtitle: "Preverite, kako leži, preden kupite",
  },
  so: {
    title: "Tijaabi muuqaalkan",
    subtitle: "Arag sida u haboon ka hor intaadan iibsan",
  },
  es: {
    title: "Pruébate este look",
    subtitle: "Ve cómo te queda antes de comprar",
  },
  sw: {
    title: "Jaribu muonekano huu",
    subtitle: "Angalia jinsi inavyofaa kabla ya kununua",
  },
  sv: {
    title: "Prova det här utseendet",
    subtitle: "Se hur det passar innan du köper",
  },
  tl: {
    title: "Subukan ang hitsura na ito",
    subtitle: "Tingnan kung paano magkasya bago bumili",
  },
  ta: {
    title: "இதை முயற்சிக்கவும்",
    subtitle: "வாங்குவதற்கு முன் பொருத்தத்தை பாருங்கள்",
  },
  te: {
    title: "ఈ లుక్ ట్రై చేయండి",
    subtitle: "కొనడానికి ముందు ఎలా ఫిట్ అవుతుందో చూడండి",
  },
  th: { title: "ลองสวมใส่ดูสิ", subtitle: "ดูว่าเหมาะกับคุณก่อนซื้อ" },
  tr: {
    title: "Bu görünümü dene",
    subtitle: "Satın almadan önce nasıl durduğunu gör",
  },
  uk: {
    title: "Приміряти цей образ",
    subtitle: "Подивіться, як сидить, перед покупкою",
  },
  ur: { title: "یہ لُک آزمائیں", subtitle: "خریدنے سے پہلے فٹ دیکھیں" },
  uz: {
    title: "Bu ko'rinishni sinab ko'ring",
    subtitle: "Sotib olishdan oldin qanday turishi ko'ring",
  },
  vi: {
    title: "Thử trang phục này",
    subtitle: "Xem cách nó phù hợp trước khi mua",
  },
  cy: {
    title: "Rhowch gynnig ar y golwg hwn",
    subtitle: "Gweler sut mae'n ffitio cyn prynu",
  },
  yi: {
    title: "פּרוּווט אָן דעם לוק",
    subtitle: "זעט ווי עס פּאַסט פֿאַר איר קויפֿן",
  },
  yo: {
    title: "Gbiyanju irisi yii",
    subtitle: "Wo bii o ṣe baamu ṣaaju ki o to ra",
  },
  zu: {
    title: "Zama lesi simo",
    subtitle: "Bona ukuthi ihlangana kanjani ngaphambi kokuthenga",
  },
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

const HEX = /^#[0-9A-Fa-f]{6}$/;

function Section({ id, title, description, action, children }) {
  return (
    <div id={id} className="fs-set-section">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        {/* Text keeps at least 200px; a header action (e.g. device toggle) wraps below it in narrow panels. */}
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <h3 className="fs-h3">{title}</h3>
          {description && <p className="fs-help" style={{ marginTop: 4 }}>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
Section.propTypes = { id: PropTypes.string, title: PropTypes.string.isRequired, description: PropTypes.string, action: PropTypes.node, children: PropTypes.node };

function ViewToggle({ value, onChange }) {
  return (
    <div className="fs-seg" role="group" aria-label="Device">
      {[["desktop", "Desktop", "monitor"], ["mobile", "Mobile", "phone"]].map(([v, l, icon]) => (
        <button key={v} type="button" className={value === v ? "is-on" : ""} aria-pressed={value === v} onClick={() => onChange(v)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FsIcon name={icon} size={14} />{l}
        </button>
      ))}
    </div>
  );
}
ViewToggle.propTypes = { value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired };

// Widget language label (e.g. "Hindi") so AI copy is written in the language shoppers see.
const AiLanguageContext = createContext("English");

const AI_TONES = [
  ["friendly", "Friendly"],
  ["bold", "Bold"],
  ["luxury", "Luxury"],
  ["playful", "Playful"],
  ["minimal", "Minimal"],
];

function AiCopyPicker({ label, value, max, onPick, children }) {
  const language = useContext(AiLanguageContext);
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState("friendly");
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const generate = async (toneArg = tone) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: label, current: value, max: max ?? 80, tone: toneArg, instructions, language }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.suggestions)) throw new Error(data.error || "AI generation failed");
      if (!data.suggestions.length) throw new Error("No suggestions came back: try another tone.");
      setSuggestions(data.suggestions);
    } catch (e) {
      setError(e.message || "AI generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !suggestions.length && !loading) generate();
  };

  return (
    <div ref={wrapRef} className="fs-ai-field">
      {children}
      <div className="fs-ai">
        <button type="button" className={`fs-ai-trigger${open ? " is-on" : ""}`} aria-label={`Generate ${label} with AI`} aria-expanded={open} title="Generate with AI" onClick={toggle}>
          <FsIcon name="sparkle" size={14} />
        </button>
      </div>
      {open && (
        <div className="fs-ai-pop" role="dialog" aria-label={`AI suggestions for ${label}`}>
          <div className="fs-ai-head">
            <FsIcon name="sparkle" size={13} />
            <span>AI suggestions</span>
            <span className="fs-ai-lang">{language}</span>
          </div>
          <div className="fs-ai-tones" role="radiogroup" aria-label="Tone">
            {AI_TONES.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={tone === v} className={`fs-ai-chip${tone === v ? " is-on" : ""}`}
                disabled={loading} onClick={() => { setTone(v); generate(v); }}>{l}</button>
            ))}
          </div>
          <div className="fs-ai-list" aria-live="polite">
            {loading && [0, 1, 2].map((i) => <div key={i} className="fs-ai-skel" />)}
            {!loading && error && <div className="fs-ai-error">{error}</div>}
            {!loading && !error && suggestions.map((s) => (
              <button key={s} type="button" className="fs-ai-option" onClick={() => { onPick(s); setOpen(false); }}>
                <span>{s}</span>
                <FsIcon name="check" size={13} />
              </button>
            ))}
          </div>
          <div className="fs-ai-foot">
            <input className="fs-input" value={instructions} maxLength={200} placeholder="Describe it (optional): e.g. mention free returns"
              onChange={(e) => setInstructions(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); generate(); } }} aria-label="Describe what you want" />
            <button type="button" className="fs-btn fs-btn--plain fs-btn--sm" disabled={loading} onClick={() => generate()} aria-label="Regenerate suggestions">
              <FsIcon name="refresh" size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
AiCopyPicker.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.string.isRequired, max: PropTypes.number, onPick: PropTypes.func.isRequired, children: PropTypes.node };

function TextInput({ label, value, onChange, placeholder, max, help, ai = false }) {
  const id = `set_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const input = <input id={id} className="fs-input" value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" style={ai ? { paddingRight: 36 } : undefined} />;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <label className="fs-label" htmlFor={id}>{label}</label>
        {max && <span className="fs-tabular" style={{ fontSize: 12, color: "var(--fs-muted)" }}>{value.length} / {max}</span>}
      </div>
      {ai ? (
        <AiCopyPicker label={label} value={value} max={max} onPick={onChange}>{input}</AiCopyPicker>
      ) : input}
      {help && <p className="fs-help">{help}</p>}
    </div>
  );
}
TextInput.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, placeholder: PropTypes.string, max: PropTypes.number, help: PropTypes.string, ai: PropTypes.bool };

function ImageUploadField({ label, value, onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.tempUrl) throw new Error(data.error || "Upload failed");
      onChange(data.tempUrl);
    } catch (e) {
      setError(e.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <span className="fs-label">{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {value ? (
          <img src={value} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--fs-border)" }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 8, border: "1px dashed var(--fs-border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fs-muted)" }}>
            <FsIcon name="image" size={18} />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button type="button" className="fs-btn fs-btn--plain fs-btn--sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? "Uploading…" : value ? "Replace" : "Upload image"}
          </button>
          {value && (
            <button type="button" className="fs-btn fs-btn--plain fs-btn--sm" onClick={() => onChange("")}>Remove</button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && <span style={{ fontSize: 11, color: "var(--fs-warning-ink)", display: "block", marginTop: 5 }}>{error}</span>}
    </div>
  );
}
ImageUploadField.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.string, onChange: PropTypes.func.isRequired };

function ColorField({ label, value, onChange, allowTransparent }) {
  const valid = HEX.test(value);
  const id = `set_color_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const swatchBg = valid ? value : "repeating-conic-gradient(#E5E7EB 0 25%, #FFFFFF 0 50%) 0 0 / 8px 8px";
  return (
    <div>
      <span className="fs-label" id={`${id}_l`}>{label}</span>
      <div className="fs-color-input">
        <label className="fs-color-input-swatch" style={{ background: swatchBg }}>
          <span className="fs-sr">{label} picker</span>
          <input type="color" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
        <input id={id} value={value} maxLength={11} onChange={(e) => onChange(e.target.value)} aria-labelledby={`${id}_l`} className="fs-tabular fs-color-input-text" style={{ textTransform: value === "transparent" ? "none" : "uppercase" }} />
        {allowTransparent && (
          <button type="button" className={`fs-btn fs-btn--plain fs-btn--sm${value === "transparent" ? " is-on" : ""}`} onClick={() => onChange("transparent")}>None</button>
        )}
      </div>
      {!valid && value !== "transparent" && <span style={{ fontSize: 11, color: "var(--fs-warning-ink)", display: "block", marginTop: 5 }}>Use #RRGGBB</span>}
    </div>
  );
}
ColorField.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, allowTransparent: PropTypes.bool };

function SliderField({ label, value, onChange, min, max, suffix = "px", hints }) {
  const id = `set_num_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return (
    <div>
      <label className="fs-label" htmlFor={id}>{label}</label>
      <div className="fs-input-row">
        <input
          id={id}
          type="number"
          className="fs-tabular"
          style={{ flex: 1, border: 0, outline: "none", background: "transparent", font: "inherit", color: "inherit" }}
          value={value}
          min={min}
          max={max}
          aria-label={`${label} value`}
          onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value, 10) || 0)))}
        />
        <span style={{ color: "var(--fs-muted)", fontSize: 12 }}>{suffix}</span>
      </div>
      {hints && <p className="fs-help">{hints[0]} · {hints[1]}</p>}
    </div>
  );
}
SliderField.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.number.isRequired, onChange: PropTypes.func.isRequired, min: PropTypes.number, max: PropTypes.number, suffix: PropTypes.string, hints: PropTypes.array };

function SelectField({ label, value, onChange, options }) {
  const id = `set_select_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return (
    <div>
      <label className="fs-label" htmlFor={id}>{label}</label>
      <select id={id} className="fs-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
SelectField.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, options: PropTypes.array.isRequired };

function SpacingInput({ label, values, onChange }) {
  const groupId = `set_spacing_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return (
    <div>
      <span id={groupId} className="fs-label">{label}</span>
      <div className="fs-spacing" role="group" aria-labelledby={groupId}>
        {["top", "right", "bottom", "left"].map((side) => (
          <label key={side} className="fs-spacing-cell">
            <span>{side}</span>
            <input type="number" min={0} max={200} value={values[side]} onChange={(e) => onChange({ ...values, [side]: parseInt(e.target.value, 10) || 0 })} aria-label={`${label} ${side}`} />
          </label>
        ))}
      </div>
    </div>
  );
}
SpacingInput.propTypes = { label: PropTypes.string.isRequired, values: PropTypes.object.isRequired, onChange: PropTypes.func.isRequired };

const LIMIT_RESETS = [
  { value: "never", label: "Never", hint: "Lifetime", phrase: "for good" },
  { value: "day", label: "Daily", hint: "Every 24 hours", phrase: "resetting every day" },
  { value: "week", label: "Weekly", hint: "Every 7 days", phrase: "resetting every week" },
  { value: "month", label: "Monthly", hint: "Every 30 days", phrase: "resetting every month" },
];

/** How many storefront try-ons each shopper gets, and when that resets. */
function TryonLimitField({ enabled, onEnabledChange, count, onCountChange, reset, onResetChange }) {
  const set = (n) => onCountChange(Math.min(100, Math.max(1, Number.isFinite(n) ? n : 1)));
  const phrase = LIMIT_RESETS.find((r) => r.value === reset)?.phrase ?? "";
  return (
    <div className="fs-limit">
      <div className={`fs-limit-head${enabled ? " is-on" : ""}`}>
        <div style={{ minWidth: 0 }}>
          <div className="fs-limit-title">Limit try-ons per shopper</div>
          <div className="fs-limit-sub">{enabled ? "Saves your credits for real buyers." : "Off: unlimited try-ons for every shopper."}</div>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Limit try-ons per shopper" className="fs-switch" onClick={() => onEnabledChange(!enabled)}><span /></button>
      </div>

      {enabled && (
        <>
          <div className="fs-limit-counter" role="group" aria-label="Try-ons per shopper">
            <button type="button" className="fs-limit-round" aria-label="One fewer" disabled={count <= 1} onClick={() => set(count - 1)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <div className="fs-limit-value">
              <input type="number" min={1} max={100} value={count} aria-label="Number of try-ons" className="fs-tabular"
                onChange={(e) => set(parseInt(e.target.value, 10))} />
              <span>try-on{count === 1 ? "" : "s"} per shopper</span>
            </div>
            <button type="button" className="fs-limit-round" aria-label="One more" disabled={count >= 100} onClick={() => set(count + 1)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <div className="fs-limit-presets" role="group" aria-label="Quick picks">
            {[1, 3, 5, 10, 20].map((n) => (
              <button key={n} type="button" className={`fs-limit-preset${count === n ? " is-on" : ""}`} aria-pressed={count === n} onClick={() => set(n)}>{n}</button>
            ))}
          </div>

          <div>
            <span className="fs-label">Reset the count</span>
            <div className="fs-limit-resets" role="radiogroup" aria-label="Reset the count">
              {LIMIT_RESETS.map((r) => (
                <button key={r.value} type="button" role="radio" aria-checked={reset === r.value}
                  className={`fs-limit-reset${reset === r.value ? " is-on" : ""}`} onClick={() => onResetChange(r.value)}>
                  <span className="fs-limit-reset-label">{r.label}</span>
                  <span className="fs-limit-reset-hint">{r.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="fs-limit-summary">
            <FsIcon name="info" size={13} />
            <span>
              Each shopper can try on <strong>{count} {count === 1 ? "time" : "times"}</strong>, {phrase}. When they run out, the try-on window tells them when they can use it again.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
TryonLimitField.propTypes = {
  enabled: PropTypes.bool.isRequired, onEnabledChange: PropTypes.func.isRequired,
  count: PropTypes.number.isRequired, onCountChange: PropTypes.func.isRequired,
  reset: PropTypes.string.isRequired, onResetChange: PropTypes.func.isRequired,
};

function ToggleRow({ checked, onChange, label, description, icon, badge }) {
  return (
    <div className="fs-toggle-row">
      {icon && <span className={`fs-tile-icon${checked ? "" : " is-muted"}`} style={{ width: 32, height: 32, flexShrink: 0 }}><FsIcon name={icon} size={16} /></span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
          {badge && <FsPill tone="primary" style={{ height: 20, fontSize: 11 }}>{badge}</FsPill>}
        </div>
        {description && <p className="fs-help" style={{ marginTop: 2 }}>{description}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="fs-switch" onClick={() => onChange(!checked)}><span /></button>
    </div>
  );
}
ToggleRow.propTypes = { checked: PropTypes.bool.isRequired, onChange: PropTypes.func.isRequired, label: PropTypes.string.isRequired, description: PropTypes.string, icon: PropTypes.string, badge: PropTypes.string };

function Collapsible({ title, hint, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fs-collapse">
      <button type="button" className="fs-collapse-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <FsIcon name="chevronRight" size={16} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
        <span style={{ fontWeight: 600 }}>{title}</span>
        {hint && <span style={{ fontWeight: 400, color: "var(--fs-muted)" }}>{hint}</span>}
      </button>
      {open && <div className="fs-collapse-body">{children}</div>}
    </div>
  );
}
Collapsible.propTypes = { title: PropTypes.string.isRequired, hint: PropTypes.string, children: PropTypes.node };

function WidgetIcon({ name, size }) {
  if (name === "eye") return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
  if (name === "sparkles") return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z" /></svg>;
  if (name === "camera") return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
  if (name === "shopping-bag") return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>;
  return null;
}
WidgetIcon.propTypes = { name: PropTypes.string, size: PropTypes.number };

function IconPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8 }} role="radiogroup" aria-label="Button icon">
      {["none", "eye", "sparkles", "camera", "shopping-bag"].map((icon) => (
        <button key={icon} type="button" role="radio" aria-checked={value === icon} aria-label={icon === "none" ? "No icon" : `${icon} icon`}
          className={`fs-icon-choice${value === icon ? " is-on" : ""}`} onClick={() => onChange(icon)}>
          {icon === "none" ? <span style={{ fontSize: 11, fontWeight: 600 }}>None</span> : <WidgetIcon name={icon} size={18} />}
        </button>
      ))}
    </div>
  );
}
IconPicker.propTypes = { value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired };

function LanguageSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const q = query.toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.nativeName && o.nativeName.toLowerCase().includes(q))) : options;

  return (
    <div>
      <span className="fs-label">Widget language</span>
      <button ref={triggerRef} type="button" className="fs-select" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", cursor: "pointer" }}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { setRect(triggerRef.current?.getBoundingClientRect() ?? null); setOpen(true); setQuery(""); }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <FsIcon name="globe" size={16} style={{ color: "var(--fs-muted)" }} />
          <span style={{ fontWeight: 600 }}>{selected?.label ?? "Select a language"}</span>
          {selected?.nativeName && selected.nativeName !== selected.label && <span style={{ fontSize: 12, color: "var(--fs-muted)" }}>{selected.nativeName}</span>}
        </span>
        <FsIcon name="chevronRight" size={14} style={{ transform: "rotate(90deg)", color: "var(--fs-muted)" }} />
      </button>
      {open && rect && createPortal(
        <div ref={panelRef} className="fs-lang-panel" style={{ top: rect.bottom + 4, left: rect.left, width: rect.width }}>
          <div style={{ padding: 8, borderBottom: "1px solid #F0F0F2" }}>
            <label className="fs-search" style={{ width: "100%" }}>
              <FsIcon name="search" size={14} />
              <input placeholder="Search languages" aria-label="Search languages" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          <div role="listbox" style={{ maxHeight: 260, overflowY: "auto", padding: 4 }}>
            {filtered.length ? filtered.map((o) => (
              <button key={o.value} type="button" role="option" aria-selected={value === o.value} className={`fs-menu-item${value === o.value ? " is-selected" : ""}`}
                style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); setQuery(""); }}>
                <span>{o.label}</span>
                {o.nativeName && o.nativeName !== o.label && <span style={{ fontSize: 12, color: "var(--fs-muted)" }}>{o.nativeName}</span>}
              </button>
            )) : <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--fs-muted)" }}>No languages match “{query}”</div>}
          </div>
        </div>,
        document.body,
      )}
      <p className="fs-help">The button text switches to this language automatically.</p>
    </div>
  );
}
LanguageSelect.propTypes = { value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, options: PropTypes.array.isRequired };

// ─── Live preview ─────────────────────────────────────────────────────────────

// Static mockup of the merchant-uploaded before/after card — mirrors the
// real storefront's clip-path split (see tryon-widget.js's
// _applyExampleSlider) but without the drag interaction, since this is just
// a preview. Uses the actual uploaded images, not a synthetic illustration.
function ExampleCardPreview({ enabled, beforeImage, afterImage, title, width, height, margin, padding }) {
  if (!enabled || !beforeImage || !afterImage) return null;
  return (
    <div
      style={{
        width: width > 0 ? width : "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        margin: `${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px`,
        padding: `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`,
      }}
    >
      {title && (
        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, textAlign: "center", color: "#111827" }}>
          {title}
        </p>
      )}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: height > 0 ? height : undefined,
          aspectRatio: height > 0 ? undefined : "3 / 4",
          borderRadius: 10,
          overflow: "hidden",
          background: "#f1f5f9",
        }}
      >
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${beforeImage})`, backgroundSize: "cover", backgroundPosition: "center top" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${afterImage})`, backgroundSize: "cover", backgroundPosition: "center top", clipPath: "inset(0 0 0 50%)" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 3, background: "#fff", transform: "translateX(-50%)", boxShadow: "0 0 0 1px rgba(0,0,0,.12)" }} />
        <div style={{ position: "absolute", top: "50%", left: "50%", width: 26, height: 26, borderRadius: "50%", background: "#fff", transform: "translate(-50%,-50%)", boxShadow: "0 2px 8px rgba(0,0,0,.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6-6 6 6 6M15 6l6 6-6 6" /></svg>
        </div>
        <span style={{ position: "absolute", top: 8, left: 8, fontSize: 9, fontWeight: 700, color: "#fff", background: "rgba(17,24,39,.65)", padding: "3px 8px", borderRadius: 999 }}>Before</span>
        <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 700, color: "#fff", background: "rgba(17,24,39,.65)", padding: "3px 8px", borderRadius: 999 }}>After</span>
      </div>
    </div>
  );
}
ExampleCardPreview.propTypes = {
  enabled: PropTypes.bool, beforeImage: PropTypes.string, afterImage: PropTypes.string, title: PropTypes.string,
  width: PropTypes.number, height: PropTypes.number, margin: PropTypes.object, padding: PropTypes.object,
};

function LivePreview({
  device, buttonColor, buttonTextColor, widgetTitle, widgetSubtitle, titleFontSize, subtitleFontSize,
  subtitleFontFamily, titleFontFamily, titleFontWeight, borderRadius, buttonIcon, iconColor, mainIconBgColor,
  collIconBgColor, iconSize, iconRadius, collectionPosition, showOnCollection, buttonWidth, buttonWidthUnit,
  buttonHeight, buttonHeightUnit, buttonPadding, buttonMargin, beforeAfterEnabled,
  exampleEnabled, exampleBeforeImage, exampleAfterImage, examplePosition, exampleTitle, exampleWidth,
  exampleHeight, exampleMargin, examplePadding,
}) {
  const btnBg = HEX.test(buttonColor) ? buttonColor : "#111827";
  const btnTxt = HEX.test(buttonTextColor) ? buttonTextColor : "#ffffff";
  const hasIcon = buttonIcon && buttonIcon !== "none";
  // Hard safety clamp on top of the slider's own range: an old/unmigrated
  // saved value (or any future bad write) can never balloon this preview
  // button again, no matter what's actually in the database.
  const safeTitleFontSize = Math.min(24, Math.max(10, Number(titleFontSize) || 16));
  const safeSubtitleFontSize = Math.min(18, Math.max(8, Number(subtitleFontSize) || 12));
  // Same defensive cap on padding — oversized saved padding shrinks the
  // available text width just as much as an oversized font does.
  const clampPad = (n) => Math.min(18, Math.max(0, Number(n) || 0));
  const safePadding = { top: clampPad(buttonPadding.top), right: clampPad(buttonPadding.right), bottom: clampPad(buttonPadding.bottom), left: clampPad(buttonPadding.left) };

  // Shared, explicit height for both buttons in the preview — "Add to cart"
  // has only one line of text while Try On has a title + subtitle, so
  // letting each size itself off its own content ("auto") never matches
  // even with identical padding/font-size. Computing one estimated height
  // from Try On's content (padding + title line + subtitle line, if any)
  // and applying it to both guarantees they always line up, regardless of
  // which one has more text.
  const titleLineHeight = safeTitleFontSize * 1.2;
  const subtitleLineHeight = widgetSubtitle ? 2 + safeSubtitleFontSize * 1.2 : 0;
  const autoHeight = Math.round(safePadding.top + safePadding.bottom + titleLineHeight + subtitleLineHeight);
  const fixedHeight = buttonHeight > 0 && buttonHeightUnit !== "auto";
  const effectiveHeight = fixedHeight ? buttonHeight : autoHeight;
  const heightStyle = fixedHeight ? { height: effectiveHeight } : { minHeight: effectiveHeight };

  const iconBox = (isCollection) => hasIcon && (
    <span style={{
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      background: isCollection ? collIconBgColor : mainIconBgColor, color: iconColor,
      width: isCollection ? iconSize * 0.8 : iconSize + 12, height: isCollection ? iconSize * 0.8 : iconSize + 12, borderRadius: iconRadius,
    }}>
      <WidgetIcon name={buttonIcon} size={isCollection ? iconSize * 0.6 : iconSize} />
    </span>
  );

  const mainBtn = (
    <span style={{
      background: btnBg, color: btnTxt, borderRadius, boxSizing: "border-box", overflow: "hidden",
      width: buttonWidth > 0 ? (buttonWidthUnit === "%" ? `${buttonWidth}%` : `${buttonWidth}px`) : "100%",
      maxWidth: "100%",
      ...heightStyle,
      padding: `${safePadding.top}px ${safePadding.right}px ${safePadding.bottom}px ${safePadding.left}px`,
      margin: `${buttonMargin.top}px ${buttonMargin.right}px ${buttonMargin.bottom}px ${buttonMargin.left}px`,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    }}>
      {iconBox(false)}
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: safeTitleFontSize, fontWeight: titleFontWeight || "600", fontFamily: titleFontFamily, lineHeight: 1.2, textAlign: "center" }}>{widgetTitle || "Try On This Look"}</span>
        {widgetSubtitle && <span style={{ fontSize: safeSubtitleFontSize, fontFamily: subtitleFontFamily, lineHeight: 1.2, textAlign: "center", opacity: 0.8 }}>{widgetSubtitle}</span>}
      </span>
    </span>
  );

  const exampleCard = (
    <ExampleCardPreview
      enabled={exampleEnabled}
      beforeImage={exampleBeforeImage}
      afterImage={exampleAfterImage}
      title={exampleTitle}
      width={exampleWidth}
      height={exampleHeight}
      margin={exampleMargin}
      padding={examplePadding}
    />
  );

  const k = device === "mobile" ? 1.4 : 1;
  const corner = { top_left: { top: 10, left: 10 }, top_right: { top: 10, right: 10 }, bottom_left: { bottom: 10, left: 10 }, bottom_right: { bottom: 10, right: 10 } }[collectionPosition] ?? { top: 10, right: 10 };
  const image = (
    <div className="fs-preview-img">
      {beforeAfterEnabled ? (
        <>
          {/* AFTER — with garment — clipped to the right half */}
          <svg viewBox="0 0 120 160" style={{ width: "76%", position: "absolute", left: "12%", bottom: 0, clipPath: "inset(0 0 0 50%)" }} aria-hidden="true">
            <circle cx="60" cy="46" r="19" fill="#E4D5C7" /><path d="M41 44a19 19 0 0 1 38 0c-4-7-11-10-19-10s-15 3-19 10z" fill="#3B2F2A" /><path d="M24 160c1-44 15-86 36-86s35 42 36 86z" fill="#B4234A" />
          </svg>
          {/* BEFORE — plain, no garment — clipped to the left half */}
          <svg viewBox="0 0 120 160" style={{ width: "76%", position: "absolute", left: "12%", bottom: 0, clipPath: "inset(0 50% 0 0)" }} aria-hidden="true">
            <circle cx="60" cy="46" r="19" fill="#E4D5C7" /><path d="M41 44a19 19 0 0 1 38 0c-4-7-11-10-19-10s-15 3-19 10z" fill="#3B2F2A" /><path d="M24 160c1-44 15-86 36-86s35 42 36 86z" fill="#D6D1C9" />
          </svg>
          <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 3, background: "#FFFFFF", transform: "translateX(-50%)", boxShadow: "0 0 0 1px rgba(0,0,0,.15)", zIndex: 2 }} />
          <div aria-hidden="true" style={{ position: "absolute", top: "50%", left: "50%", width: 26, height: 26, borderRadius: "50%", background: "#FFFFFF", transform: "translate(-50%,-50%)", boxShadow: "0 2px 8px rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3, color: "#374151" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6-6 6 6 6M15 6l6 6-6 6" /></svg>
          </div>
          <span style={{ position: "absolute", bottom: 8, left: 8, fontSize: 9 * k, fontWeight: 700, color: "#fff", background: "rgba(17,24,39,.65)", padding: `${2 * k}px ${7 * k}px`, borderRadius: 999, zIndex: 2 }}>BEFORE</span>
          <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 9 * k, fontWeight: 700, color: "#fff", background: "rgba(17,24,39,.65)", padding: `${2 * k}px ${7 * k}px`, borderRadius: 999, zIndex: 2 }}>AFTER</span>
        </>
      ) : (
        <svg viewBox="0 0 120 160" style={{ width: "76%", display: "block" }} aria-hidden="true"><circle cx="60" cy="46" r="19" fill="#E4D5C7" /><path d="M41 44a19 19 0 0 1 38 0c-4-7-11-10-19-10s-15 3-19 10z" fill="#3B2F2A" /><path d="M24 160c1-44 15-86 36-86s35 42 36 86z" fill="#B4234A" /></svg>
      )}
      {showOnCollection && (
        <span style={{ position: "absolute", ...corner, display: "flex", alignItems: "center", gap: 4 * k, padding: `${5 * k}px ${10 * k}px`, background: `${btnBg}dd`, color: btnTxt, borderRadius, boxShadow: "0 2px 8px rgba(0,0,0,.15)", fontSize: 10 * k, fontWeight: 700 }}>
          {iconBox(true)}Try On
        </span>
      )}
    </div>
  );

  // Illustrative "Add to cart" mock — sized from the same padding/height/
  // font-size settings as the real Try On button, not fixed numbers, so the
  // two stay visually matched in the preview as the merchant adjusts
  // padding, height, or font size. (On the real storefront the two buttons
  // are independent — this is purely so the preview itself looks neat and
  // aligned, not an actual style sync.)
  const addToCartMock = (
    <span
      style={{
        ...heightStyle,
        borderRadius: 8,
        background: "#111827",
        color: "#FFFFFF",
        fontSize: Math.min(safeTitleFontSize, 16),
        fontWeight: 600,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${safePadding.top}px ${safePadding.right}px ${safePadding.bottom}px ${safePadding.left}px`,
      }}
    >
      Add to cart
    </span>
  );

  if (device === "mobile") {
    return (
      <div className="fs-phone">
        <div className="fs-phone-screen">
          <div className="fs-phone-canvas">
            <div className="fs-phone-status" aria-hidden="true"><span>9:41</span><span className="fs-phone-notch" /><span>100%</span></div>
            {image}
            <div style={{ padding: "16px 16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "#6B7280" }}>Your store</span>
                <span style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>Silk Banarasi Saree</span>
                <span className="fs-tabular" style={{ fontSize: 18 }}>$749.95</span>
              </div>
              {addToCartMock}
              {examplePosition === "above_button" && exampleCard}
              <div style={{ display: "flex" }}>{mainBtn}</div>
              {examplePosition !== "above_button" && exampleCard}
              <span style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>Free shipping over $150 · Easy returns</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fs-browser">
      <div className="fs-browser-bar"><span /><span /><span /><em>yourstore.com/products/silk-banarasi-saree</em></div>
      <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0, 1fr)", gap: 14, padding: 14 }}>
        {image}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#6B7280" }}>Your store</span>
          <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>Silk Banarasi Saree</span>
          <span className="fs-tabular" style={{ fontSize: 16 }}>$749.95</span>
          {addToCartMock}
          {examplePosition === "above_button" && exampleCard}
          <div style={{ display: "flex" }}>{mainBtn}</div>
          {examplePosition !== "above_button" && exampleCard}
          <span style={{ fontSize: 11, color: "#6B7280", lineHeight: 1.5 }}>Free shipping over $150 · Easy returns</span>
        </div>
      </div>
    </div>
  );
}
LivePreview.propTypes = {
  device: PropTypes.string, buttonColor: PropTypes.string, buttonTextColor: PropTypes.string, widgetTitle: PropTypes.string,
  widgetSubtitle: PropTypes.string, titleFontSize: PropTypes.number, subtitleFontSize: PropTypes.number, titleFontFamily: PropTypes.string,
  subtitleFontFamily: PropTypes.string, titleFontWeight: PropTypes.string, borderRadius: PropTypes.number, buttonIcon: PropTypes.string,
  iconColor: PropTypes.string, mainIconBgColor: PropTypes.string, collIconBgColor: PropTypes.string, iconSize: PropTypes.number,
  iconRadius: PropTypes.number, collectionPosition: PropTypes.string, showOnCollection: PropTypes.bool, buttonWidth: PropTypes.number,
  buttonWidthUnit: PropTypes.string, buttonHeight: PropTypes.number, buttonHeightUnit: PropTypes.string, buttonPadding: PropTypes.object,
  buttonMargin: PropTypes.object, beforeAfterEnabled: PropTypes.bool,
  exampleEnabled: PropTypes.bool, exampleBeforeImage: PropTypes.string, exampleAfterImage: PropTypes.string,
  examplePosition: PropTypes.string, exampleTitle: PropTypes.string, exampleWidth: PropTypes.number,
  exampleHeight: PropTypes.number, exampleMargin: PropTypes.object, examplePadding: PropTypes.object,
};

// ─── Modal quick edit ─────────────────────────────────────────────────────────

const MODAL_TEXT_FIELDS = [
  ["modal_title", "Modal title"],
  ["modal_subtitle", "Modal subtitle"],
  ["upload_heading", "Upload heading"],
  ["privacy_notice_text", "Privacy note"],
  ["processing_heading", "While generating"],
  ["add_to_cart_text", "Add to cart button"],
];
const MODAL_COLOR_FIELDS = [
  ["modal_primary_color", "Primary color"],
  ["modal_surface_color", "Background"],
  ["modal_text_color", "Text color"],
];

function ModalEditor({ json, onChange }) {
  let parsed = null;
  try { parsed = JSON.parse(json); } catch { parsed = null; }
  const valid = parsed && typeof parsed === "object" && !Array.isArray(parsed);
  const setKey = (k, v) => onChange(JSON.stringify({ ...parsed, [k]: v }, null, 2));

  return (
    <>
      {valid ? (
        <>
          {MODAL_TEXT_FIELDS.map(([k, label]) => (
            <TextInput key={k} label={label} value={String(parsed[k] ?? "")} onChange={(v) => setKey(k, v)} ai />
          ))}
          {MODAL_COLOR_FIELDS.map(([k, label]) => (
            <ColorField key={k} label={label} value={String(parsed[k] ?? "#FFFFFF")} onChange={(v) => setKey(k, v)} />
          ))}
        </>
      ) : (
        <div className="fs-banner fs-banner--warning" role="alert"><FsIcon name="info" size={16} /><span>The JSON below has a syntax error: fix it to use the quick editor again.</span></div>
      )}
      <Collapsible title="Advanced: edit all modal text as JSON" hint={valid ? `${Object.keys(parsed).length} keys` : "needs fixing"}>
        <textarea className="fs-textarea fs-code" value={json} onChange={(e) => onChange(e.target.value)} rows={18} spellCheck={false} aria-label="Modal content JSON" />
        <p className="fs-help">Every modal label and color can be overridden here: camera, countdown, coupon, error and watermark texts included.</p>
      </Collapsible>
    </>
  );
}
ModalEditor.propTypes = { json: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired };

// ─── Settings Page ────────────────────────────────────────────────────────────

const TABS = [
  { id: "button", label: "Button design", icon: "layout" },
  { id: "typography", label: "Text & style", icon: "type" },
  { id: "modal", label: "Modal content", icon: "message" },
  { id: "media", label: "Media", icon: "video" },
  { id: "example", label: "Before/after images", icon: "image" },
  { id: "collection", label: "Collection icon", icon: "grid" },
  { id: "features", label: "Features", icon: "sliders" },
  { id: "limits", label: "Try-on limits", icon: "target" },
];

const DEFAULT_MODAL = {
  modal_title: "Brix-TryOn",
  modal_subtitle: "See how this item looks on you before you buy.",
  privacy_notice_text: "Your photo is never stored after processing",
  privacy_cta_text: "Get Started",
  upload_heading: "Upload Your Photo",
  upload_subheading: "Choose a front-facing photo for the best result.",
  upload_primary_desktop: "Click or drag & drop your photo",
  upload_primary_mobile: "Tap to choose a photo or use your camera",
  upload_secondary: "JPEG, PNG or WebP: up to 5 MB",
  camera_title: "Allow Camera Access",
  camera_description: "We need your camera to take a photo.",
  camera_allow_text: "Allow Camera",
  camera_back_text: "Upload a photo instead",
  processing_heading: "Creating your look…",
  processing_resize_text: "Resizing your photo…",
  processing_generating_text: "Brix-TryOn is creating your look…",
  processing_message: "Brix-TryOn is creating your look…",
  processing_note: "This usually takes 20–35 seconds",
  countdown_prefix_text: "Your look is ready! Decide in ",
  coupon_label: "Your exclusive discount",
  add_to_cart_text: "Add to Cart",
  buy_now_text: "Buy Now",
  add_to_cart_loading_text: "Adding…",
  buy_now_loading_text: "Loading…",
  save_image_text: "Save",
  share_whatsapp_text: "Share on WhatsApp",
  retry_text: "Try Again",
  error_title: "Something went wrong",
  watermark_text: "Powered by Brix-TryOn",
  modal_primary_color: "#6b3f17",
  modal_primary_text_color: "#ffffff",
  modal_primary_hover_color: "#5a3313",
  modal_surface_color: "#ffffff",
  modal_surface_secondary_color: "#f8f4ee",
  modal_border_color: "#e4d8c8",
  modal_border_hover_color: "#cbbba6",
  modal_text_color: "#111827",
  modal_text_secondary_color: "#667085",
  modal_text_muted_color: "#98a2b3",
  modal_overlay_color: "rgba(17, 17, 17, 0.66)",
};

function SettingsForm({ settings, shop, currentPlan, onDiscard }) {
  const fetcher = useFetcher();
  const celebrate = useCelebrate();
  const isSubmitting = fetcher.state === "submitting";
  const actionData = fetcher.data;
  const [activeTab, setActiveTab] = useState("button");
  const [errorMsg, setErrorMsg] = useState(null);

  // Button text
  const [widgetTitle, setWidgetTitle] = useState(settings?.widget_title ?? "Try On This Look");
  const [widgetSubtitle, setWidgetSubtitle] = useState(settings?.widget_subtitle ?? "See how it fits before you buy");
  const [modalSettingsJson, setModalSettingsJson] = useState(() => {
    const current = settings?.modal_settings_json;
    if (typeof current === "string" && current.trim()) return current;
    return JSON.stringify(current || DEFAULT_MODAL, null, 2);
  });

  // Button colors & shape
  const [buttonColor, setButtonColor] = useState(settings?.button_color ?? "#111827");
  const [buttonTextColor, setButtonTextColor] = useState(settings?.button_text_color ?? "#FFFFFF");
  const [borderRadius, setBorderRadius] = useState(settings?.button_border_radius ?? 8);
  const [hoverBg, setHoverBg] = useState(settings?.hover_bg_color ?? "#F3F4F6");

  // Button dimensions
  const [buttonWidth, setButtonWidth] = useState(settings?.button_width ?? 0);
  const [buttonHeight, setButtonHeight] = useState(settings?.button_height ?? 0);
  const [buttonMargin, setButtonMargin] = useState({
    top: settings?.button_margin_top ?? 0,
    right: settings?.button_margin_right ?? 0,
    bottom: settings?.button_margin_bottom ?? 0,
    left: settings?.button_margin_left ?? 0,
  });

  // Typography
  // Clamped to the slider's range (min=8/max=18) — older saved rows (or ones
  // from before the range was tightened) could hold values the slider can no
  // longer represent, e.g. 40px, which made the preview button balloon and
  // wrap onto 3 lines even after the container width was fixed.
  const [subtitleFontSize, setSubtitleFontSize] = useState(Math.min(18, Math.max(8, settings?.subtitle_font_size ?? 12)));
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
  const [iconShape] = useState(settings?.icon_shape ?? "square");
  const [iconOpacity] = useState(settings?.icon_opacity ?? 100);
  const [showOnCollection, setShowOnCollection] = useState(Boolean(settings?.show_on_collection ?? true));
  const [collectionPosition, setCollectionPosition] = useState(settings?.collection_position ?? "top_right");

  // Features & compliance
  const [shareWa, setShareWa] = useState(Boolean(settings?.share_whatsapp_enabled ?? true));
  const [saveImg, setSaveImg] = useState(Boolean(settings?.save_image_enabled ?? true));
  const [privacy, setPrivacy] = useState(Boolean(settings?.privacy_notice_shown ?? true));
  const [limitEnabled, setLimitEnabled] = useState(Boolean(settings?.tryon_limit_enabled ?? true));
  const [limitCount, setLimitCount] = useState(Number(settings?.tryon_limit_count ?? 3) || 3);
  const [limitReset, setLimitReset] = useState(settings?.tryon_limit_reset ?? "never");

  // Before/After slider & promo video
  const [beforeAfterEnabled] = useState(Boolean(settings?.before_after_enabled ?? false));
  const [promoVideoUrl, setPromoVideoUrl] = useState(settings?.promo_video_url ?? "");
  const [promoVideoPosition, setPromoVideoPosition] = useState(settings?.promo_video_position ?? "below_button");

  // Merchant-uploaded before/after example images — independent of any
  // product data, shown as a static comparison slider above/below the Try
  // On button when enabled.
  const [exampleBeforeAfterEnabled, setExampleBeforeAfterEnabled] = useState(Boolean(settings?.example_before_after_enabled ?? false));
  const [exampleBeforeImage, setExampleBeforeImage] = useState(settings?.example_before_image ?? "");
  const [exampleAfterImage, setExampleAfterImage] = useState(settings?.example_after_image ?? "");
  const [exampleSliderPosition, setExampleSliderPosition] = useState(settings?.example_slider_position ?? "below_button");
  const [exampleTitle, setExampleTitle] = useState(settings?.example_title ?? "");
  const [exampleWidth, setExampleWidth] = useState(settings?.example_width ?? 320);
  const [exampleHeight, setExampleHeight] = useState(settings?.example_height ?? 0);
  const [exampleMargin, setExampleMargin] = useState({
    top: settings?.example_margin_top ?? 10,
    right: settings?.example_margin_right ?? 0,
    bottom: settings?.example_margin_bottom ?? 0,
    left: settings?.example_margin_left ?? 0,
  });
  const [examplePadding, setExamplePadding] = useState({
    top: settings?.example_padding_top ?? 0,
    right: settings?.example_padding_right ?? 0,
    bottom: settings?.example_padding_bottom ?? 0,
    left: settings?.example_padding_left ?? 0,
  });

  // View-mode customization (desktop / mobile)
  const [viewMode, setViewMode] = useState("desktop");
  const [widgetDimensions, setWidgetDimensions] = useState({
    desktop: {
      // 0 matches the real default everywhere else (AppConfig, WidgetController,
      // the live storefront JS) — "0 = full width / auto height", not a fixed
      // pixel size. A stale 480/600 fallback here made the preview button a
      // fixed size instead of stretching to match "Add to cart" like it
      // actually does on the storefront.
      width: settings?.desktop_widget_width ?? 0,
      widthUnit: settings?.desktop_widget_width_unit ?? "px",
      height: settings?.desktop_widget_height ?? 0,
      heightUnit: settings?.desktop_widget_height_unit ?? "auto",
    },
    mobile: {
      width: settings?.mobile_widget_width ?? 100,
      widthUnit: settings?.mobile_widget_width_unit ?? "%",
      height: settings?.mobile_widget_height ?? 0,
      heightUnit: settings?.mobile_widget_height_unit ?? "auto",
    },
  });
  // Clamped to the slider's range (min=10/max=24) — see subtitleFontSize note above.
  const [fontSizeByView, setFontSizeByView] = useState({
    desktop: Math.min(24, Math.max(10, settings?.desktop_title_font_size ?? settings?.title_font_size ?? 16)),
    mobile: Math.min(24, Math.max(10, settings?.mobile_title_font_size ?? 14)),
  });
  const [paddingByView, setPaddingByView] = useState({
    desktop: {
      top: settings?.desktop_padding_top ?? 14,
      right: settings?.desktop_padding_right ?? 24,
      bottom: settings?.desktop_padding_bottom ?? 14,
      left: settings?.desktop_padding_left ?? 24,
    },
    mobile: {
      top: settings?.mobile_padding_top ?? 8,
      right: settings?.mobile_padding_right ?? 16,
      bottom: settings?.mobile_padding_bottom ?? 8,
      left: settings?.mobile_padding_left ?? 16,
    },
  });
  // Mirrors desktop padding so legacy button_padding_* fields stay in sync on save
  const buttonPadding = paddingByView.desktop;

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

  const payload = {
    widget_title: widgetTitle,
    widget_subtitle: widgetSubtitle,
    modal_settings_json: modalSettingsJson,
    // All CSS / style fields sent flat so PHP receives them as direct top-level keys.
    // Nesting them under a "css" sub-object risks them being lost when React Router
    // serialises with FormData (nested objects become the string "[object Object]").
    button_color: buttonColor,
    button_text_color: buttonTextColor,
    hover_bg_color: hoverBg,
    button_border_radius: borderRadius,
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
    title_font_size: fontSizeByView.desktop,
    subtitle_font_size: subtitleFontSize,
    title_font_weight: titleFontWeight,
    title_font_family: titleFontFamily,
    subtitle_font_family: subtitleFontFamily,
    desktop_widget_width: widgetDimensions.desktop.width,
    desktop_widget_width_unit: widgetDimensions.desktop.widthUnit,
    desktop_widget_height: widgetDimensions.desktop.height,
    desktop_widget_height_unit: widgetDimensions.desktop.heightUnit,
    mobile_widget_width: widgetDimensions.mobile.width,
    mobile_widget_width_unit: widgetDimensions.mobile.widthUnit,
    mobile_widget_height: widgetDimensions.mobile.height,
    mobile_widget_height_unit: widgetDimensions.mobile.heightUnit,
    desktop_title_font_size: fontSizeByView.desktop,
    mobile_title_font_size: fontSizeByView.mobile,
    desktop_padding_top: paddingByView.desktop.top,
    desktop_padding_right: paddingByView.desktop.right,
    desktop_padding_bottom: paddingByView.desktop.bottom,
    desktop_padding_left: paddingByView.desktop.left,
    mobile_padding_top: paddingByView.mobile.top,
    mobile_padding_right: paddingByView.mobile.right,
    mobile_padding_bottom: paddingByView.mobile.bottom,
    mobile_padding_left: paddingByView.mobile.left,
    button_icon: buttonIcon,
    icon_color: iconColor,
    main_icon_bg_color: mainIconBgColor,
    coll_icon_bg_color: collIconBgColor,
    icon_size: iconSize,
    icon_radius: iconRadius,
    icon_shape: iconShape,
    icon_opacity: iconOpacity,
    widget_language: language,
    show_on_collection: showOnCollection,
    collection_position: collectionPosition,
    share_whatsapp_enabled: shareWa,
    save_image_enabled: saveImg,
    privacy_notice_shown: privacy,
    tryon_limit_enabled: limitEnabled,
    tryon_limit_count: limitCount,
    tryon_limit_reset: limitReset,
    before_after_enabled: beforeAfterEnabled,
    promo_video_url: promoVideoUrl,
    promo_video_position: promoVideoPosition,
    example_before_after_enabled: exampleBeforeAfterEnabled,
    example_before_image: exampleBeforeImage,
    example_after_image: exampleAfterImage,
    example_slider_position: exampleSliderPosition,
    example_title: exampleTitle,
    example_width: exampleWidth,
    example_height: exampleHeight,
    example_margin_top: exampleMargin.top,
    example_margin_right: exampleMargin.right,
    example_margin_bottom: exampleMargin.bottom,
    example_margin_left: exampleMargin.left,
    example_padding_top: examplePadding.top,
    example_padding_right: examplePadding.right,
    example_padding_bottom: examplePadding.bottom,
    example_padding_left: examplePadding.left,
    shopify_domain: shop,
  };
  const payloadKey = JSON.stringify(payload);
  const savedKey = useRef(payloadKey);
  const dirty = payloadKey !== savedKey.current;

  useEffect(() => {
    if (!actionData) return;
    if (actionData?.ok) {
      savedKey.current = payloadKey;
      setErrorMsg(null);
      celebrate({ title: "Settings saved", body: "Your try-on button is updated on the storefront." });
    } else if (actionData?.error) {
      setErrorMsg(actionData.error);
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const handleSave = () => {
    fetcher.submit(payload, {
      method: "POST",
      encType: "application/json",
      action: "/api/widget-settings",
    });
  };

  // Setup checklist — each check reflects a setting that helps conversion.
  const checks = [
    { label: "Custom button text", done: widgetTitle.trim() !== "" && widgetTitle !== "Try On This Look", tab: "button" },
    { label: "Brand button color", done: HEX.test(buttonColor) && buttonColor.toLowerCase() !== "#111827", tab: "button" },
    { label: "Supporting subtitle", done: widgetSubtitle.trim() !== "", tab: "button" },
    { label: "Button icon", done: buttonIcon !== "none", tab: "collection" },
    { label: "Collection page icon", done: showOnCollection, tab: "collection" },
    { label: "WhatsApp share", done: shareWa, tab: "features" },
    { label: "Save image", done: saveImg, tab: "features" },
    { label: "Privacy notice", done: privacy, tab: "features" },
  ];
  const todo = checks.filter((c) => !c.done);
  const updateDims = (patch) => setWidgetDimensions((prev) => ({ ...prev, [viewMode]: { ...prev[viewMode], ...patch } }));

  const ACCORDION_CONTENT = {
    button: (
      <>
        <Section title="Button text" description="The label shoppers see on product pages.">
          <TextInput label="Button title" value={widgetTitle} onChange={setWidgetTitle} placeholder="Try On This Look" max={60} help="Short and action-led works best." ai />
          <TextInput label="Subtitle" value={widgetSubtitle} onChange={setWidgetSubtitle} placeholder="See how it fits before you buy" max={200} ai />
        </Section>
        <Section title="Colors and shape">
          <ColorField label="Button color" value={buttonColor} onChange={setButtonColor} />
          <ColorField label="Text color" value={buttonTextColor} onChange={setButtonTextColor} />
          <SliderField label="Corner radius" value={borderRadius} onChange={setBorderRadius} min={0} max={40} hints={["Square", "Pill"]} />
          <ColorField label="Hover background" value={hoverBg} onChange={setHoverBg} />
        </Section>
        <Section title="Size" description="Set sizes separately for desktop and mobile." action={<ViewToggle value={viewMode} onChange={setViewMode} />}>
          <div>
            <span className="fs-label">Widget width</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="fs-input" type="number" min={0} max={widgetDimensions[viewMode].widthUnit === "%" ? 100 : 2000} value={widgetDimensions[viewMode].width} onChange={(e) => updateDims({ width: parseInt(e.target.value, 10) || 0 })} aria-label="Widget width" />
              <div className="fs-seg">{["px", "%"].map((u) => <button key={u} type="button" className={widgetDimensions[viewMode].widthUnit === u ? "is-on" : ""} onClick={() => updateDims({ widthUnit: u })}>{u}</button>)}</div>
            </div>
          </div>
          <div>
            <span className="fs-label">Widget height</span>
            <div style={{ display: "flex", gap: 8 }}>
              {widgetDimensions[viewMode].heightUnit === "auto"
                ? <div className="fs-input" style={{ display: "flex", alignItems: "center", color: "var(--fs-muted)", background: "#F9FAFB" }}>Auto</div>
                : <input className="fs-input" type="number" min={0} max={2000} value={widgetDimensions[viewMode].height} onChange={(e) => updateDims({ height: parseInt(e.target.value, 10) || 0 })} aria-label="Widget height" />}
              <div className="fs-seg">{["px", "auto"].map((u) => <button key={u} type="button" className={widgetDimensions[viewMode].heightUnit === u ? "is-on" : ""} onClick={() => updateDims({ heightUnit: u })}>{u}</button>)}</div>
            </div>
          </div>
          <Collapsible title="Advanced spacing" hint="Button size, padding and margin">
            <SliderField label="Button width" value={buttonWidth} onChange={setButtonWidth} min={0} max={800} hints={["0 = full width", "800px"]} />
            <SliderField label="Button height" value={buttonHeight} onChange={setButtonHeight} min={0} max={200} hints={["0 = auto", "200px"]} />
            <SpacingInput label={`Padding (${viewMode})`} values={paddingByView[viewMode]} onChange={(val) => setPaddingByView((prev) => ({ ...prev, [viewMode]: val }))} />
            <SpacingInput label="Margin" values={buttonMargin} onChange={setButtonMargin} />
          </Collapsible>
          <SliderField label={`Title size (${viewMode})`} value={fontSizeByView[viewMode]} onChange={(val) => setFontSizeByView((prev) => ({ ...prev, [viewMode]: val }))} min={10} max={24} />
          <SliderField label="Subtitle size" value={subtitleFontSize} onChange={setSubtitleFontSize} min={8} max={18} />
        </Section>
      </>
    ),
    typography: (
      <PlanGate currentPlan={currentPlan} requiredPlan="growth" featureName="Typography & branding controls" mode="overlay">
        <Section title="Typography" description="Weight and family for the button (size is set in Button design)." action={<ViewToggle value={viewMode} onChange={setViewMode} />}>
          <SelectField label="Title weight" value={titleFontWeight} onChange={setTitleFontWeight} options={FONT_WEIGHT_OPTIONS} />
          <SelectField label="Title font" value={titleFontFamily} onChange={setTitleFontFamily} options={FONT_FAMILY_OPTIONS} />
          <SelectField label="Subtitle font" value={subtitleFontFamily} onChange={setSubtitleFontFamily} options={FONT_FAMILY_OPTIONS} />
        </Section>
        <PlanGate currentPlan={currentPlan} requiredPlan="pro" featureName="Multi-language widget" mode="overlay">
          <Section title="Language" description="Show the try-on experience in your shoppers' language.">
            <LanguageSelect value={language} onChange={setLanguage} options={WORLD_LANGUAGES} />
          </Section>
        </PlanGate>
      </PlanGate>
    ),
    modal: (
      <Section title="Modal content" description="The words and colors shoppers see inside the try-on window.">
        <ModalEditor json={modalSettingsJson} onChange={setModalSettingsJson} />
      </Section>
    ),
    media: (
      <>
        {/* Commented out for now — Result display / Before-after slider toggle.
        <Section title="Result display" description="How shoppers see their finished try-on.">
          <ToggleRow
            checked={beforeAfterEnabled}
            onChange={setBeforeAfterEnabled}
            icon="image"
            label="Before/after slider"
            description="Shoppers drag a divider between their original photo and the try-on result, instead of seeing a single static image."
          />
        </Section>
        */}
        <Section title="Promo video" description="An optional clip shown above or below the Try On button on your product pages: how it works, not the try-on result itself.">
          <TextInput
            label="Video URL"
            value={promoVideoUrl}
            onChange={setPromoVideoUrl}
            placeholder="https://..."
            max={500}
            help="A direct link to an MP4, or a YouTube/Vimeo URL. Leave blank to hide."
          />
          <SelectField
            label="Position"
            value={promoVideoPosition}
            onChange={setPromoVideoPosition}
            options={[
              { value: "below_button", label: "Below the Try On button" },
              { value: "above_button", label: "Above the Try On button" },
            ]}
          />
        </Section>
      </>
    ),
    example: (
      <Section
        title="Before/after images"
        description="A static before/after comparison slider shown above or below the Try On button. You upload both images: not tied to any product."
        action={<button type="button" role="switch" aria-checked={exampleBeforeAfterEnabled} aria-label="Show before/after images" className="fs-switch" onClick={() => setExampleBeforeAfterEnabled(!exampleBeforeAfterEnabled)}><span /></button>}
      >
        {exampleBeforeAfterEnabled && (
          <>
            <ImageUploadField label="Before image" value={exampleBeforeImage} onChange={setExampleBeforeImage} />
            <ImageUploadField label="After image" value={exampleAfterImage} onChange={setExampleAfterImage} />
            <SelectField
              label="Position"
              value={exampleSliderPosition}
              onChange={setExampleSliderPosition}
              options={[
                { value: "below_button", label: "Below the Try On button" },
                { value: "above_button", label: "Above the Try On button" },
              ]}
            />
            <Collapsible title="Customize appearance" hint="Size & spacing">
              <TextInput
                label="Title"
                value={exampleTitle}
                onChange={setExampleTitle}
                placeholder="e.g. See the Transformation"
                max={80}
                help="Optional heading shown above the slider. Leave blank to hide."
                ai
              />
              <SliderField label="Width" value={exampleWidth} onChange={setExampleWidth} min={100} max={800} hints={["100px", "800px"]} />
              <SliderField label="Height" value={exampleHeight} onChange={setExampleHeight} min={0} max={800} hints={["0 = auto (3:4 ratio)", "800px"]} />
              <SpacingInput label="Margin" values={exampleMargin} onChange={setExampleMargin} />
              <SpacingInput label="Padding" values={examplePadding} onChange={setExamplePadding} />
            </Collapsible>
          </>
        )}
      </Section>
    ),
    collection: (
      <>
        <Section title="Button icon" description="Shown on the product-page button and the collection badge.">
          <div><span className="fs-label">Icon</span><IconPicker value={buttonIcon} onChange={setButtonIcon} /></div>
          <ColorField label="Icon color" value={iconColor} onChange={setIconColor} />
          <ColorField label="Button icon background" value={mainIconBgColor} onChange={setMainIconBgColor} allowTransparent />
          <SliderField label="Icon size" value={iconSize} onChange={setIconSize} min={8} max={48} />
        </Section>
        <PlanGate currentPlan={currentPlan} requiredPlan="growth" featureName="Collection page icons">
          <Section title="Collection page badge" description="A small try-on badge on product cards in your collections."
            action={<button type="button" role="switch" aria-checked={showOnCollection} aria-label="Show on collection pages" className="fs-switch" onClick={() => setShowOnCollection(!showOnCollection)}><span /></button>}>
            {showOnCollection ? (
              <div className="fs-corner-layout">
                <div>
                  <span className="fs-label">Position</span>
                  <div className="fs-corner-card">
                    <svg viewBox="0 0 120 160" style={{ position: "absolute", bottom: 0, left: "15%", width: "70%" }} aria-hidden="true"><circle cx="60" cy="46" r="19" fill="#E4D5C7" /><path d="M24 160c1-44 15-86 36-86s35 42 36 86z" fill="#9CA3AF" /></svg>
                    {["top_left", "top_right", "bottom_left", "bottom_right"].map((pos) => (
                      <button key={pos} type="button" className={`fs-corner fs-corner--${pos}${collectionPosition === pos ? " is-on" : ""}`}
                        aria-label={pos.replace("_", " ")} aria-pressed={collectionPosition === pos} onClick={() => setCollectionPosition(pos)}>
                        {collectionPosition === pos && <FsIcon name="sparkle" size={15} />}
                      </button>
                    ))}
                  </div>
                  <p className="fs-help">Tap a corner to move the badge.</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <ColorField label="Icon background" value={collIconBgColor} onChange={setCollIconBgColor} allowTransparent />
                  <SliderField label="Corner radius" value={iconRadius} onChange={setIconRadius} min={0} max={32} />
                </div>
              </div>
            ) : (
              <FsEmpty icon="grid" text="Turn this on so shoppers spot try-on while browsing collections." cta="Show the badge" onClick={() => setShowOnCollection(true)} />
            )}
          </Section>
        </PlanGate>
      </>
    ),
    features: (
      <PlanGate currentPlan={currentPlan} requiredPlan="growth" featureName="Sharing and saving features">
        <Section title="Features" description="What shoppers can do with their try-on result.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ToggleRow checked={shareWa} onChange={setShareWa} icon="message" label="WhatsApp share" badge="Top converter" description="One tap to send the result to friends for a second opinion." />
            <ToggleRow checked={saveImg} onChange={setSaveImg} icon="download" label="Save image" description="Shoppers can download their try-on photo." />
            <ToggleRow checked={privacy} onChange={setPrivacy} icon="lock" label="Privacy notice" description="Show a consent notice before the shopper uploads a photo." />
          </div>
        </Section>
      </PlanGate>
    ),
    limits: (
      <Section title="Try-on limits" description="How many times each shopper can use try-on on your store.">
        <TryonLimitField
          enabled={limitEnabled} onEnabledChange={setLimitEnabled}
          count={limitCount} onCountChange={setLimitCount}
          reset={limitReset} onResetChange={setLimitReset}
        />
      </Section>
    ),
  };

  const aiLanguage = WORLD_LANGUAGES.find((l) => l.value === language)?.label ?? "English";

  return (
    <AiLanguageContext.Provider value={aiLanguage}>
    <FsPage
      tour={TOURS.settings}
      title={
        <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          Try-on button and modal
          {dirty && <FsPill tone="warning"><span className="fs-dot" style={{ background: "var(--fs-warning)" }} />Unsaved changes</FsPill>}
        </span>
      }
      subtitle="Changes appear on your storefront after you save."
    >
      {errorMsg && (
        <div className="fs-banner fs-banner--critical" role="alert">
          <FsIcon name="info" size={16} /><span style={{ flex: 1 }}>{errorMsg}</span>
          <button type="button" className="fs-icon-btn" aria-label="Dismiss" onClick={() => setErrorMsg(null)}><FsIcon name="x" size={14} /></button>
        </div>
      )}

      <div className="fs-settings-layout">
        {/* LEFT: settings, as vertical collapsible bars */}
        <section className="fs-card fs-acc-panel">
          {TABS.map((t) => {
            const open = activeTab === t.id;
            return (
              <div key={t.id} className={`fs-acc-item${open ? " is-open" : ""}`}>
                <button type="button" className="fs-acc-head" aria-expanded={open} onClick={() => setActiveTab(open ? null : t.id)}>
                  <FsIcon name={t.icon} size={16} />
                  <span className="fs-acc-title">{t.label}</span>
                  <FsIcon name="chevronRight" size={14} className="fs-acc-chev" style={{ transform: open ? "rotate(90deg)" : "none" }} />
                </button>
                {open && <div className="fs-acc-body">{ACCORDION_CONTENT[t.id]}</div>}
              </div>
            );
          })}
        </section>

        {/* RIGHT: sticky preview + score */}
        <aside className="fs-settings-aside">
          <div className="fs-live-controls">
            <span className="fs-live-controls-label">Live preview</span>
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <div style={{ flex: 1 }} />
            <FsButton variant="ghost" size="sm" onClick={onDiscard} disabled={!dirty || isSubmitting}>Discard</FsButton>
            <FsButton variant="dark" size="sm" onClick={handleSave} disabled={!dirty || isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</FsButton>
          </div>
          <FsCard style={{ padding: 14 }}>
            <div className="fs-preview-stage">
              <LivePreview
                device={viewMode}
                buttonColor={buttonColor}
                buttonTextColor={buttonTextColor}
                widgetTitle={widgetTitle}
                widgetSubtitle={widgetSubtitle}
                titleFontSize={fontSizeByView[viewMode]}
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
                showOnCollection={showOnCollection}
                collectionPosition={collectionPosition}
                buttonWidth={widgetDimensions[viewMode].width}
                buttonWidthUnit={widgetDimensions[viewMode].widthUnit}
                buttonHeight={widgetDimensions[viewMode].heightUnit === "auto" ? 0 : widgetDimensions[viewMode].height}
                buttonHeightUnit={widgetDimensions[viewMode].heightUnit}
                buttonPadding={paddingByView[viewMode]}
                buttonMargin={buttonMargin}
                beforeAfterEnabled={beforeAfterEnabled}
                exampleEnabled={exampleBeforeAfterEnabled}
                exampleBeforeImage={exampleBeforeImage}
                exampleAfterImage={exampleAfterImage}
                examplePosition={exampleSliderPosition}
                exampleTitle={exampleTitle}
                exampleWidth={exampleWidth}
                exampleHeight={exampleHeight}
                exampleMargin={exampleMargin}
                examplePadding={examplePadding}
              />
            </div>
          </FsCard>

          <FsCard style={{ padding: 22 }}>
            <div>
              <div className="fs-eyebrow">Setup checklist</div>
              <div className="fs-tabular" style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{checks.length - todo.length} of {checks.length} done</div>
              <div style={{ fontSize: 13, color: "var(--fs-muted)", marginTop: 2 }}>{todo.length ? `${todo.length} quick tweak${todo.length === 1 ? "" : "s"} left` : "Every conversion booster is on"}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {checks.map((c) => (
                <div key={c.label} className={`fs-score-row${c.done ? " is-done" : ""}`}>
                  <span className="fs-score-mark">{c.done && <FsIcon name="check" size={12} strokeWidth={3.2} />}</span>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {!c.done && <button type="button" className="fs-btn fs-btn--plain fs-btn--sm" style={{ height: 24 }} onClick={() => setActiveTab(c.tab)}>Fix</button>}
                </div>
              ))}
            </div>
          </FsCard>
        </aside>
      </div>
    </FsPage>
    </AiLanguageContext.Provider>
  );
}
SettingsForm.propTypes = { settings: PropTypes.object, shop: PropTypes.string, currentPlan: PropTypes.string, onDiscard: PropTypes.func };

export default function Settings() {
  const { settings, shop, currentPlan } = useLoaderData();
  // Remounting the form restores every field to the last saved values.
  const [formKey, setFormKey] = useState(0);
  return <SettingsForm key={formKey} settings={settings} shop={shop} currentPlan={currentPlan} onDiscard={() => setFormKey((k) => k + 1)} />;
}

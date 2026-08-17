import PropTypes from "prop-types";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import PlanGate from "../components/PlanGate";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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

function SectionCard({ title, description, children }) {
  return (
    <div
      className="vto-card"
      style={{ padding: 0, overflow: "hidden", marginBottom: "24px" }}
    >
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--vto-border)",
        }}
      >
        <h3 className="vto-title" style={{ fontSize: "0.875rem" }}>
          {title}
        </h3>
        {description && (
          <p
            className="vto-subtitle"
            style={{ fontSize: "0.6875rem", marginTop: "4px" }}
          >
            {description}
          </p>
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

function ViewToggle({ value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "#F3F4F6",
        borderRadius: "20px",
        padding: "3px",
        gap: "2px",
      }}
    >
      {["desktop", "mobile"].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          style={{
            background: value === v ? "#1a1a1a" : "transparent",
            color: value === v ? "#ffffff" : "#9CA3AF",
            borderRadius: "20px",
            fontSize: "10px",
            fontWeight: 600,
            height: "28px",
            padding: "0 14px",
            border: "none",
            cursor: "pointer",
            transition: "all 0.15s",
            lineHeight: "28px",
            whiteSpace: "nowrap",
          }}
        >
          {v === "desktop" ? "Desktop" : "Mobile"}
        </button>
      ))}
    </div>
  );
}
ViewToggle.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

function PositionCard({ id, label, sub, icon, active, onClick }) {
  const icons = {
    monitor: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    cart: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => onClick(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(id);
        }
      }}
      className={`vto-card cursor-pointer transition-all duration-200 border-2 ${active ? "border-blue-600 bg-blue-50" : "border-transparent"}`}
      style={{
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <div
        className={`p-3 rounded-lg mb-3 ${active ? "text-blue-600" : "text-gray-400"}`}
      >
        {icons[icon] ?? null}
      </div>
      <p
        className={`text-sm font-bold ${active ? "text-blue-700" : "text-gray-900"}`}
      >
        {label}
      </p>
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
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
              {icon === "sparkles" && (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z" />
                </svg>
              )}
              {icon === "camera" && (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              )}
              {icon === "shopping-bag" && (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
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
  const inputId = name || `vto_${label.toLowerCase().replace(/\s+/g, "_")}`;
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-sm font-bold text-gray-900"
      >
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        name={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
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
  const inputId = `vto_color_${label.toLowerCase().replace(/\s+/g, "_")}`;
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-sm font-bold text-gray-900"
      >
        {label}
      </label>
      <div className="flex items-center gap-2.5">
        <label
          htmlFor={inputId + "_color"}
          className="flex-shrink-0 w-12 h-12 rounded-xl border-2 border-gray-100 cursor-pointer relative shadow-sm overflow-hidden"
          style={{ background: isValid ? value : "#ccc" }}
        >
          <span className="sr-only">{label} color</span>
          <input
            id={inputId + "_color"}
            type="color"
            value={isValid ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </label>
        <input
          id={inputId}
          type="text"
          name={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#111827"
          maxLength={7}
          autoComplete="off"
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
  const inputId = `vto_number_${label.toLowerCase().replace(/\s+/g, "_")}`;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <label htmlFor={inputId} className="text-sm font-bold text-gray-900">
          {label}
        </label>
        {suffix && (
          <span className="text-[10px] font-bold text-gray-400">{suffix}</span>
        )}
      </div>
      <input
        id={inputId}
        type="number"
        min={min}
        max={max}
        autoComplete="off"
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
  const inputId = `vto_select_${label.toLowerCase().replace(/\s+/g, "_")}`;
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-sm font-bold text-gray-900"
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={inputId}
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
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94A3B8"
            strokeWidth="2"
          >
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
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    }),
  ).isRequired,
};

function SearchableSelect({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);

  // Recalculate position on open
  const openDropdown = () => {
    if (triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen(true);
    setQuery("");
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (
        triggerRef.current &&
        !triggerRef.current.closest("[data-lang-select]").contains(e.target)
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.nativeName &&
            o.nativeName.toLowerCase().includes(query.toLowerCase())),
      )
    : options;

  const dropdown =
    open &&
    rect &&
    createPortal(
      <div
        style={{
          position: "fixed",
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 99999,
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: "12px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Search */}
        <div
          style={{
            padding: "8px",
            borderBottom: "1px solid #F3F4F6",
            background: "#F9FAFB",
          }}
        >
          <div style={{ position: "relative" }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9CA3AF"
              strokeWidth="2"
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search languages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: "100%",
                paddingLeft: "32px",
                paddingRight: "12px",
                paddingTop: "8px",
                paddingBottom: "8px",
                fontSize: "12px",
                border: "1px solid #E5E7EB",
                borderRadius: "8px",
                background: "#fff",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ maxHeight: "260px", overflowY: "auto" }}>
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  fontSize: "12px",
                  border: "none",
                  cursor: "pointer",
                  background: value === opt.value ? "#EEF2FF" : "transparent",
                  color: value === opt.value ? "#3B5BDB" : "#374151",
                  fontWeight: value === opt.value ? 600 : 400,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </span>
                {opt.nativeName && opt.nativeName !== opt.label && (
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#9CA3AF",
                      flexShrink: 0,
                    }}
                  >
                    {opt.nativeName}
                  </span>
                )}
              </button>
            ))
          ) : (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: "12px",
                color: "#9CA3AF",
              }}
            >
              No languages match &quot;{query}&quot;
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "8px 16px",
            borderTop: "1px solid #F3F4F6",
            background: "#F9FAFB",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "10px", color: "#9CA3AF" }}>
            {filtered.length} of {options.length} languages
          </span>
          {query && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery("");
              }}
              style={{
                fontSize: "10px",
                color: "#3B5BDB",
                fontWeight: 600,
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>,
      document.body,
    );

  return (
    <div data-lang-select="">
      <label
        style={{
          display: "block",
          fontSize: "12px",
          fontWeight: 700,
          color: "#111827",
          marginBottom: "6px",
        }}
      >
        {label}
      </label>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDropdown}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          fontSize: "12px",
          border: "1px solid #E5E7EB",
          borderRadius: "10px",
          background: "#fff",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {selected ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontWeight: 600,
                color: "#111827",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selected.label}
            </span>
            {selected.nativeName && selected.nativeName !== selected.label && (
              <span
                style={{ fontSize: "10px", color: "#9CA3AF", flexShrink: 0 }}
              >
                {selected.nativeName}
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: "#9CA3AF" }}>Select a language…</span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94A3B8"
          strokeWidth="2.5"
          style={{
            flexShrink: 0,
            marginLeft: "8px",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {dropdown}
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
    }),
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
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            {description}
          </p>
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
  const groupId = `vto_spacing_${label.toLowerCase().replace(/\s+/g, "_")}`;
  return (
    <div className="space-y-2">
      <span id={groupId} className="block text-sm font-bold text-gray-900">
        {label}
      </span>
      <div
        className="grid grid-cols-2 gap-2"
        role="group"
        aria-labelledby={groupId}
      >
        {sides.map((side) => {
          const inputId = `${groupId}_${side}`;
          return (
            <div key={side} className="space-y-1">
              <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                {side}
              </span>
              <div className="relative">
                <input
                  id={inputId}
                  type="number"
                  value={values[side]}
                  min={0}
                  max={200}
                  onChange={(e) =>
                    onChange({
                      ...values,
                      [side]: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 pr-8 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-semibold bg-white"
                  aria-label={side}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 pointer-events-none">
                  {suffix}
                </span>
              </div>
            </div>
          );
        })}
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
  buttonWidthUnit,
  buttonHeight,
  buttonHeightUnit,
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
          <svg
            width={svgSz}
            height={svgSz}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
        {buttonIcon === "sparkles" && (
          <svg
            width={svgSz}
            height={svgSz}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 3l1.912 5.886L20 10.8l-5.886 1.912L12 18.6l-1.912-5.886L3 10.8l5.886-1.912z" />
          </svg>
        )}
        {buttonIcon === "camera" && (
          <svg
            width={svgSz}
            height={svgSz}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}
        {buttonIcon === "shopping-bag" && (
          <svg
            width={svgSz}
            height={svgSz}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
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
    border: "none",
    borderRadius: `${borderRadius}px`,
    width: buttonWidth > 0
      ? (buttonWidthUnit === "%" ? `${buttonWidth}%` : `${buttonWidth}px`)
      : "100%",
    height: buttonHeight > 0 && buttonHeightUnit !== "auto"
      ? `${buttonHeight}px`
      : "auto",
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
    cursor: "pointer",
    transition: "all 0.2s",
    boxSizing: "border-box",
    overflow: "hidden",
  };

  const posClass =
    {
      top_left: "top-3 left-3",
      top_right: "top-3 right-3",
      bottom_left: "bottom-3 left-3",
      bottom_right: "bottom-3 right-3",
    }[collectionPosition] ?? "top-3 right-3";

  // Removed unused isTop variable

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
              <span style={{ fontSize: "10px", fontWeight: "bold" }}>
                Try On
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Summer Dress</h2>
            <p className="text-xs text-gray-500">Premium Collection</p>
          </div>
          <div className="text-right">
            <p className="text-base font-bold text-gray-900">$89.00</p>
            <p className="text-[9px] text-gray-400 line-through">$120.00</p>
          </div>
        </div>

        <div className="space-y-3">
          <div
            style={{
              display: "flex",
              justifyContent: buttonWidth > 0 ? "flex-start" : "stretch",
            }}
          >
            <button style={mainBtnStyle}>
              {hasIcon && renderIcon()}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                <span
                  style={{
                    fontSize: `${titleFontSize}px`,
                    fontWeight: titleFontWeight || "600",
                    fontFamily: titleFontFamily,
                    lineHeight: 1.2,
                    textAlign: "center",
                  }}
                >
                  {widgetTitle || "Try On This Look"}
                </span>
                <span
                  style={{
                    fontSize: `${subtitleFontSize}px`,
                    fontFamily: subtitleFontFamily,
                    lineHeight: 1.2,
                    textAlign: "center",
                    opacity: 0.8,
                    display: widgetSubtitle ? "block" : "none",
                  }}
                >
                  {widgetSubtitle}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 py-3.5 flex items-center justify-center border-t border-gray-50">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">
          Powered by FitSnap
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
  buttonWidthUnit: PropTypes.string,
  buttonHeight: PropTypes.number,
  buttonHeightUnit: PropTypes.string,
  buttonPadding: PropTypes.object,
  buttonMargin: PropTypes.object,
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ content, error, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000); // 5s for errors/notices
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white text-sm font-medium px-6 py-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/10"
      style={{ animation: "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      <div
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${error ? "bg-red-500" : "bg-emerald-500"}`}
      >
        {error ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3.5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <span className="pr-2">{content}</span>
      <button
        onClick={onDismiss}
        className="ml-auto p-1 hover:bg-white/10 rounded-lg transition-colors"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="opacity-50"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
Toast.propTypes = {
  content: PropTypes.node.isRequired,
  error: PropTypes.bool,
  onDismiss: PropTypes.func.isRequired,
};

// ─── Settings Page ────────────────────────────────────────────────────────────

export default function Settings() {
  const { settings, shop, currentPlan } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const isSubmitting = fetcher.state === "submitting";
  const actionData = fetcher.data;

  const [toastActive, setToastActive] = useState(false);
  const [activeTab, setActiveTab] = useState("button");

  // Button text
  const [widgetTitle, setWidgetTitle] = useState(
    settings?.widget_title ?? "Try On This Look",
  );
  const [widgetSubtitle, setWidgetSubtitle] = useState(
    settings?.widget_subtitle ?? "See how it fits before you buy",
  );
  const [modalSettingsJson, setModalSettingsJson] = useState(() => {
    const fallback = {
      modal_title: "FitSnap",
      modal_subtitle: "See how this item looks on you before you buy.",
      privacy_notice_text: "Your photo is never stored after processing",
      privacy_cta_text: "Get Started",
      upload_heading: "Upload Your Photo",
      upload_subheading: "Choose a front-facing photo for the best result.",
      upload_primary_desktop: "Click or drag & drop your photo",
      upload_primary_mobile: "Tap to choose a photo or use your camera",
      upload_secondary: "JPEG, PNG or WebP — up to 5 MB",
      camera_title: "Allow Camera Access",
      camera_description: "We need your camera to take a photo.",
      camera_allow_text: "Allow Camera",
      camera_back_text: "Upload a photo instead",
      processing_heading: "Creating your look…",
      processing_resize_text: "Resizing your photo…",
      processing_generating_text: "FitSnap is creating your look…",
      processing_message: "FitSnap is creating your look…",
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
      watermark_text: "Powered by FitSnap",
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
    const current = settings?.modal_settings_json;
    if (typeof current === "string" && current.trim()) return current;
    return JSON.stringify(current || fallback, null, 2);
  });

  // Button colors & shape
  const [buttonColor, setButtonColor] = useState(
    settings?.button_color ?? "#111827",
  );
  const [buttonTextColor, setButtonTextColor] = useState(
    settings?.button_text_color ?? "#FFFFFF",
  );
  const [borderRadius, setBorderRadius] = useState(
    settings?.button_border_radius ?? 8,
  );
  const [hoverBg, setHoverBg] = useState(settings?.hover_bg_color ?? "#F3F4F6");

  // Button dimensions
  const [buttonWidth, setButtonWidth] = useState(settings?.button_width ?? 0);
  const [buttonHeight, setButtonHeight] = useState(
    settings?.button_height ?? 0,
  );
  const [buttonMargin, setButtonMargin] = useState({
    top: settings?.button_margin_top ?? 0,
    right: settings?.button_margin_right ?? 0,
    bottom: settings?.button_margin_bottom ?? 0,
    left: settings?.button_margin_left ?? 0,
  });

  // Typography
  const [subtitleFontSize, setSubtitleFontSize] = useState(
    settings?.subtitle_font_size ?? 14,
  );
  const [titleFontWeight, setTitleFontWeight] = useState(
    settings?.title_font_weight ?? "600",
  );
  const [titleFontFamily, setTitleFontFamily] = useState(
    settings?.title_font_family ?? "Inter, sans-serif",
  );
  const [subtitleFontFamily, setSubtitleFontFamily] = useState(
    settings?.subtitle_font_family ?? "Inter, sans-serif",
  );
  const [language, setLanguage] = useState(settings?.widget_language ?? "en");

  // Collection icon
  const [buttonIcon, setButtonIcon] = useState(settings?.button_icon ?? "eye");
  const [iconColor, setIconColor] = useState(settings?.icon_color ?? "#FFFFFF");
  const [mainIconBgColor, setMainIconBgColor] = useState(
    settings?.main_icon_bg_color ?? "transparent",
  );
  const [collIconBgColor, setCollIconBgColor] = useState(
    settings?.coll_icon_bg_color ?? "transparent",
  );
  const [iconSize, setIconSize] = useState(settings?.icon_size ?? 16);
  const [iconRadius, setIconRadius] = useState(settings?.icon_radius ?? 4);
  const [iconShape] = useState(settings?.icon_shape ?? "square");
  const [iconOpacity] = useState(settings?.icon_opacity ?? 100);
  const [showOnCollection, setShowOnCollection] = useState(
    Boolean(settings?.show_on_collection ?? true),
  );
  const [collectionPosition, setCollectionPosition] = useState(
    settings?.collection_position ?? "top_right",
  );

  // Features & compliance
  const [shareWa, setShareWa] = useState(
    Boolean(settings?.share_whatsapp_enabled ?? true),
  );
  const [saveImg, setSaveImg] = useState(
    Boolean(settings?.save_image_enabled ?? true),
  );
  const [privacy, setPrivacy] = useState(
    Boolean(settings?.privacy_notice_shown ?? true),
  );

  // View-mode customization (desktop / mobile)
  const [viewMode, setViewMode] = useState("desktop");
  const [widgetDimensions, setWidgetDimensions] = useState({
    desktop: {
      width: settings?.desktop_widget_width ?? 480,
      widthUnit: settings?.desktop_widget_width_unit ?? "px",
      height: settings?.desktop_widget_height ?? 600,
      heightUnit: settings?.desktop_widget_height_unit ?? "px",
    },
    mobile: {
      width: settings?.mobile_widget_width ?? 100,
      widthUnit: settings?.mobile_widget_width_unit ?? "%",
      height: settings?.mobile_widget_height ?? 0,
      heightUnit: settings?.mobile_widget_height_unit ?? "auto",
    },
  });
  const [fontSizeByView, setFontSizeByView] = useState({
    desktop:
      settings?.desktop_title_font_size ?? settings?.title_font_size ?? 20,
    mobile: settings?.mobile_title_font_size ?? 14,
  });
  const [paddingByView, setPaddingByView] = useState({
    desktop: {
      top: settings?.desktop_padding_top ?? 10,
      right: settings?.desktop_padding_right ?? 24,
      bottom: settings?.desktop_padding_bottom ?? 10,
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

  const [errorToast, setErrorToast] = useState(null);

  useEffect(() => {
    if (!actionData) return;
    console.log("[FitSnap] Save response from action:", actionData);
    if (actionData?.ok) {
      setToastActive(true);
      setErrorToast(null);
    } else if (actionData?.error) {
      setErrorToast(actionData.error);
    }
  }, [actionData]);

  const handleSave = () => {
    fetcher.submit(
      {
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
        shopify_domain: shop,
      },
      {
        method: "POST",
        encType: "application/json",
        action: "/api/widget-settings",
      },
    );
  };

  const TABS = [
    { id: "button", label: "Button Design" },
    { id: "typography", label: "Text & Style" },
    { id: "modal", label: "Modal Content" },
    { id: "collection", label: "Collection Icon" },
    { id: "features", label: "Features" },
  ];

  return (
    <div className="min-h-screen bg-[#F6F6F7]">
      {toastActive && (
        <Toast
          content="Settings saved successfully!"
          onDismiss={() => setToastActive(false)}
        />
      )}

      {errorToast && (
        <Toast
          content={errorToast}
          error
          onDismiss={() => setErrorToast(null)}
        />
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
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              type="button"
              onClick={() => navigate("/app")}
              aria-label="Back to Dashboard"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "6px",
                color: "#111827",
                flexShrink: 0,
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div>
              <h1
                className="vto-title"
                style={{ fontSize: "0.875rem", marginBottom: "2px" }}
              >
                Button Settings &amp; Configuration
              </h1>
              <p className="text-[9px] text-gray-400 font-medium">
                Manage your button appearance, collection icons, and typography
                settings
              </p>
            </div>
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 lg:gap-8 items-start">
          {/* LEFT: scrollable form */}
          <div className="space-y-6 min-w-0 pb-12 lg:pb-48">
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
                <SectionCard
                  title="Button Text"
                  description="Configure the label and subtitle shown inside the button."
                >
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

                <SectionCard
                  title="Colors & Shape"
                  description="Button background, text color, and corner radius."
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                    <ColorPicker
                      label="Button Color"
                      value={buttonColor}
                      onChange={setButtonColor}
                    />
                    <ColorPicker
                      label="Button Text Color"
                      value={buttonTextColor}
                      onChange={setButtonTextColor}
                    />
                    <ColorPicker
                      label="Hover Background"
                      value={hoverBg}
                      onChange={setHoverBg}
                    />
                    <NumberInput
                      label="Border Radius"
                      value={borderRadius}
                      onChange={setBorderRadius}
                      min={0}
                      max={100}
                      suffix="px"
                    />
                  </div>
                </SectionCard>

                {/* Size & Dimensions — view-aware */}
                <div
                  className="vto-card"
                  style={{
                    padding: 0,
                    overflow: "hidden",
                    marginBottom: "24px",
                  }}
                >
                  <div
                    style={{
                      padding: "20px 24px",
                      borderBottom: "1px solid var(--vto-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <h3 className="vto-title" style={{ fontSize: "0.875rem" }}>
                        Size &amp; Dimensions
                      </h3>
                      <p
                        className="vto-subtitle"
                        style={{ fontSize: "0.6875rem", marginTop: "4px" }}
                      >
                        Widget container and button dimensions per view.
                      </p>
                    </div>
                    <ViewToggle value={viewMode} onChange={setViewMode} />
                  </div>
                  <div style={{ padding: "24px" }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                      {/* Widget Width — view-specific */}
                      <div>
                        <span className="block text-sm font-bold text-gray-900 mb-2">
                          Widget Width
                        </span>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="number"
                            value={widgetDimensions[viewMode].width}
                            min={0}
                            max={
                              widgetDimensions[viewMode].widthUnit === "%"
                                ? 100
                                : 2000
                            }
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              setWidgetDimensions((prev) => ({
                                ...prev,
                                [viewMode]: { ...prev[viewMode], width: val },
                              }));
                            }}
                            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-semibold bg-white"
                          />
                          <div
                            style={{
                              display: "flex",
                              background: "#F3F4F6",
                              borderRadius: "12px",
                              padding: "3px",
                              gap: "2px",
                              flexShrink: 0,
                            }}
                          >
                            {["px", "%"].map((unit) => (
                              <button
                                key={unit}
                                type="button"
                                onClick={() =>
                                  setWidgetDimensions((prev) => ({
                                    ...prev,
                                    [viewMode]: {
                                      ...prev[viewMode],
                                      widthUnit: unit,
                                    },
                                  }))
                                }
                                style={{
                                  background:
                                    widgetDimensions[viewMode].widthUnit ===
                                    unit
                                      ? "#1a1a1a"
                                      : "transparent",
                                  color:
                                    widgetDimensions[viewMode].widthUnit ===
                                    unit
                                      ? "#ffffff"
                                      : "#9CA3AF",
                                  borderRadius: "9px",
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  height: "28px",
                                  padding: "0 10px",
                                  border: "none",
                                  cursor: "pointer",
                                  transition: "all 0.15s",
                                }}
                              >
                                {unit}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {/* Widget Height — view-specific */}
                      <div>
                        <span className="block text-sm font-bold text-gray-900 mb-2">
                          Widget Height
                        </span>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                          }}
                        >
                          {widgetDimensions[viewMode].heightUnit === "auto" ? (
                            <div className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 font-semibold text-gray-400">
                              Auto
                            </div>
                          ) : (
                            <input
                              type="number"
                              value={widgetDimensions[viewMode].height}
                              min={0}
                              max={2000}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setWidgetDimensions((prev) => ({
                                  ...prev,
                                  [viewMode]: {
                                    ...prev[viewMode],
                                    height: val,
                                  },
                                }));
                              }}
                              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-semibold bg-white"
                            />
                          )}
                          <div
                            style={{
                              display: "flex",
                              background: "#F3F4F6",
                              borderRadius: "12px",
                              padding: "3px",
                              gap: "2px",
                              flexShrink: 0,
                            }}
                          >
                            {["px", "auto"].map((unit) => (
                              <button
                                key={unit}
                                type="button"
                                onClick={() =>
                                  setWidgetDimensions((prev) => ({
                                    ...prev,
                                    [viewMode]: {
                                      ...prev[viewMode],
                                      heightUnit: unit,
                                    },
                                  }))
                                }
                                style={{
                                  background:
                                    widgetDimensions[viewMode].heightUnit ===
                                    unit
                                      ? "#1a1a1a"
                                      : "transparent",
                                  color:
                                    widgetDimensions[viewMode].heightUnit ===
                                    unit
                                      ? "#ffffff"
                                      : "#9CA3AF",
                                  borderRadius: "9px",
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  height: "28px",
                                  padding: "0 10px",
                                  border: "none",
                                  cursor: "pointer",
                                  transition: "all 0.15s",
                                }}
                              >
                                {unit}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {/* Button-level dimensions (unchanged) */}
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
                  </div>
                </div>

                {/* Padding — view-aware */}
                <div
                  className="vto-card"
                  style={{
                    padding: 0,
                    overflow: "hidden",
                    marginBottom: "24px",
                  }}
                >
                  <div
                    style={{
                      padding: "20px 24px",
                      borderBottom: "1px solid var(--vto-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <h3 className="vto-title" style={{ fontSize: "0.875rem" }}>
                        Padding
                      </h3>
                      <p
                        className="vto-subtitle"
                        style={{ fontSize: "0.6875rem", marginTop: "4px" }}
                      >
                        Inner spacing between button text and its edges.
                      </p>
                    </div>
                    <ViewToggle value={viewMode} onChange={setViewMode} />
                  </div>
                  <div style={{ padding: "24px" }}>
                    <SpacingInput
                      label="Padding (Top / Right / Bottom / Left)"
                      values={paddingByView[viewMode]}
                      onChange={(val) =>
                        setPaddingByView((prev) => ({
                          ...prev,
                          [viewMode]: val,
                        }))
                      }
                      suffix="px"
                    />
                  </div>
                </div>

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
              <PlanGate
                currentPlan={currentPlan}
                requiredPlan="growth"
                featureName="Typography & Branding Controls"
                mode="overlay"
              >
                <div className="space-y-6">
                  {/* Typography — view-aware title font size */}
                  <div
                    className="vto-card"
                    style={{
                      padding: 0,
                      overflow: "hidden",
                      marginBottom: "24px",
                    }}
                  >
                    <div
                      style={{
                        padding: "20px 24px",
                        borderBottom: "1px solid var(--vto-border)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <h3 className="vto-title" style={{ fontSize: "0.875rem" }}>
                          Typography
                        </h3>
                        <p
                          className="vto-subtitle"
                          style={{ fontSize: "0.6875rem", marginTop: "4px" }}
                        >
                          Control font sizes, weights and families.
                        </p>
                      </div>
                      <ViewToggle value={viewMode} onChange={setViewMode} />
                    </div>
                    <div style={{ padding: "24px" }}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                        <NumberInput
                          label={`Title Font Size (${viewMode === "desktop" ? "Desktop" : "Mobile"})`}
                          value={fontSizeByView[viewMode]}
                          onChange={(val) =>
                            setFontSizeByView((prev) => ({
                              ...prev,
                              [viewMode]: val,
                            }))
                          }
                          min={8}
                          max={72}
                          suffix="px"
                        />
                        <NumberInput
                          label="Subtitle Font Size"
                          value={subtitleFontSize}
                          onChange={setSubtitleFontSize}
                          min={8}
                          max={48}
                          suffix="px"
                        />
                        <SelectField
                          label="Title Font Weight"
                          value={titleFontWeight}
                          onChange={setTitleFontWeight}
                          options={FONT_WEIGHT_OPTIONS}
                        />
                        <SelectField
                          label="Title Font Family"
                          value={titleFontFamily}
                          onChange={setTitleFontFamily}
                          options={FONT_FAMILY_OPTIONS}
                        />
                        <SelectField
                          label="Subtitle Font Family"
                          value={subtitleFontFamily}
                          onChange={setSubtitleFontFamily}
                          options={FONT_FAMILY_OPTIONS}
                        />
                      </div>
                    </div>
                  </div>

                  <PlanGate
                    currentPlan={currentPlan}
                    requiredPlan="pro"
                    featureName="Multi-language Widget"
                    mode="overlay"
                  >
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
                  </PlanGate>
                </div>
              </PlanGate>
            )}

            {/* ── Modal Content tab ── */}
            {activeTab === "modal" && (
              <SectionCard
                title="Modal Content JSON"
                description="Override every modal label and color with one JSON object."
              >
                <div className="space-y-4">
                  <textarea
                    value={modalSettingsJson}
                    onChange={(e) => setModalSettingsJson(e.target.value)}
                    rows={24}
                    spellCheck={false}
                    className="w-full font-mono text-sm px-4 py-3 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all bg-white"
                    style={{ minHeight: "520px", lineHeight: 1.5 }}
                  />
                  <p className="text-xs text-gray-500 leading-5">
                    Supported keys include{" "}
                    <span className="font-semibold text-gray-700">
                      modal_title
                    </span>
                    ,{" "}
                    <span className="font-semibold text-gray-700">
                      modal_subtitle
                    </span>
                    ,{" "}
                    <span className="font-semibold text-gray-700">
                      upload_heading
                    </span>
                    ,{" "}
                    <span className="font-semibold text-gray-700">
                      camera_title
                    </span>
                    ,{" "}
                    <span className="font-semibold text-gray-700">
                      add_to_cart_text
                    </span>
                    ,{" "}
                    <span className="font-semibold text-gray-700">
                      modal_primary_color
                    </span>
                    , and the other starter fields in the JSON.
                  </p>
                </div>
              </SectionCard>
            )}

            {/* ── Collection Icon tab ── */}
            {activeTab === "collection" && (
              <PlanGate
                currentPlan={currentPlan}
                requiredPlan="growth"
                featureName="Collection Page Icons"
              >
                <SectionCard
                  title="Collection Icon"
                  description="Customize the VTO icon on product listing cards."
                >
                  <Toggle
                    checked={showOnCollection}
                    onChange={setShowOnCollection}
                    label="Show on Collection Pages"
                    description="Enable the mini try-on icon for product listings."
                  />

                  {showOnCollection && (
                    <div className="space-y-8 mt-6 pt-6 border-t border-gray-100">
                      <div>
                        <span className="block text-sm font-bold text-gray-900 mb-4">
                          Position on Product Cards
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {[
                            {
                              id: "top_left",
                              label: "Top Left",
                              sub: "Over image",
                              icon: "monitor",
                            },
                            {
                              id: "top_right",
                              label: "Top Right",
                              sub: "Over image",
                              icon: "monitor",
                            },
                            {
                              id: "bottom_left",
                              label: "Bottom Left",
                              sub: "Action corner",
                              icon: "cart",
                            },
                            {
                              id: "bottom_right",
                              label: "Bottom Right",
                              sub: "Action corner",
                              icon: "cart",
                            },
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
                          <span className="block text-sm font-bold text-gray-900">
                            Icon Choice
                          </span>
                          <IconPicker
                            value={buttonIcon}
                            onChange={setButtonIcon}
                          />
                        </div>
                        <ColorPicker
                          label="Icon Color"
                          value={iconColor}
                          onChange={setIconColor}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                        <ColorPicker
                          label="Main Button Icon BG"
                          value={mainIconBgColor}
                          onChange={setMainIconBgColor}
                        />
                        <ColorPicker
                          label="Collection Icon BG"
                          value={collIconBgColor}
                          onChange={setCollIconBgColor}
                        />
                        <NumberInput
                          label="Icon Size"
                          value={iconSize}
                          onChange={setIconSize}
                          min={8}
                          max={48}
                        />
                        <NumberInput
                          label="Icon Border Radius"
                          value={iconRadius}
                          onChange={setIconRadius}
                          min={0}
                          max={32}
                        />
                      </div>
                    </div>
                  )}
                </SectionCard>
              </PlanGate>
            )}

            {/* ── Features & Compliance tab ── */}
            {activeTab === "features" && (
              <PlanGate
                currentPlan={currentPlan}
                requiredPlan="growth"
                featureName="Advanced Features (WhatsApp Share, Conversion Tracking)"
              >
                <SectionCard
                  title="Features & Compliance"
                  description="Enable or disable optional features and notices."
                >
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
              </PlanGate>
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
              iconShape={iconShape}
              iconOpacity={iconOpacity}
              showOnCollection={showOnCollection}
              collectionPosition={collectionPosition}
              buttonWidth={widgetDimensions[viewMode].width}
              buttonWidthUnit={widgetDimensions[viewMode].widthUnit}
              buttonHeight={widgetDimensions[viewMode].heightUnit === "auto" ? 0 : widgetDimensions[viewMode].height}
              buttonHeightUnit={widgetDimensions[viewMode].heightUnit}
              buttonPadding={paddingByView[viewMode]}
              buttonMargin={buttonMargin}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

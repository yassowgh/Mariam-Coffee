// KVKK (Turkish Personal Data Protection Law No. 6698) notice shown when a customer is registered,
// in the customer's language. The customer's agreement is recorded with the date and this version.
// {name} = the business name set by the owner in Customers → Levels & gifts.
export const KVKK_VERSION = '2026-11-v1';

export const KVKK = {
  en: {
    title: 'Privacy notice (KVKK)',
    text: '{name} processes your mobile number, your name and birthday (if you give them), your language and your visits, to run the loyalty programme: counting your orders and giving you gifts. If you say yes to special offers, we will also use your number to send you offers by WhatsApp or SMS; you can stop them at any time. Your data is used only for these purposes, is not sold or shared with other companies, and is kept with our IT service provider, whose servers may be outside Türkiye. You can ask us at any time to see, correct or delete your data (KVKK Article 11), at the counter or on +90 555 184 41 15.',
    agree: 'The customer has heard / read this notice and agrees (including storage with our service provider abroad).',
  },
  ar: {
    title: 'إشعار حماية البيانات (KVKK)',
    text: 'يعالج {name} رقم جوالك، واسمك وتاريخ ميلادك (إن قدّمتهما)، ولغتك وزياراتك، لتشغيل برنامج الولاء: احتساب طلباتك وتقديم الهدايا لك. وإذا وافقت على العروض الخاصة، سنستخدم رقمك أيضاً لإرسال العروض عبر واتساب أو الرسائل النصية، ويمكنك إيقافها في أي وقت. تُستخدم بياناتك لهذه الأغراض فقط، ولا تُباع ولا تُشارك مع شركات أخرى، وتُحفظ لدى مزوّد الخدمات التقنية لدينا وقد تكون خوادمه خارج تركيا. يمكنك في أي وقت أن تطلب الاطلاع على بياناتك أو تصحيحها أو حذفها (المادة 11 من قانون KVKK)، عند الكاونتر أو على الرقم ‎+90 555 184 41 15.',
    agree: 'استمع العميل إلى هذا الإشعار أو قرأه ويوافق عليه (بما في ذلك حفظ البيانات لدى مزوّد الخدمة خارج تركيا).',
  },
  tr: {
    title: 'Aydınlatma metni (KVKK)',
    text: '{name}, sadakat programını yürütmek (siparişlerinizi saymak ve size hediye vermek) amacıyla cep telefonu numaranızı, verdiyseniz adınızı ve doğum gününüzü, dil tercihinizi ve ziyaretlerinizi işler. Özel kampanyaları kabul ederseniz, numaranız size WhatsApp veya SMS ile kampanya göndermek için de kullanılır; bunu istediğiniz zaman durdurabilirsiniz. Verileriniz yalnızca bu amaçlarla kullanılır, satılmaz ve başka şirketlerle paylaşılmaz; sunucuları Türkiye dışında olabilecek bilgi teknolojileri hizmet sağlayıcımızda saklanır. 6698 sayılı KVKK\'nın 11. maddesi kapsamında verilerinize erişme, düzeltilmesini veya silinmesini isteme hakkınızı kasada ya da +90 555 184 41 15 numarasından her zaman kullanabilirsiniz.',
    agree: 'Müşteri bu metni dinledi / okudu ve onaylıyor (verilerin yurt dışındaki hizmet sağlayıcıda saklanması dahil).',
  },
};
export const kvkkText = (lang, name) => {
  const k = KVKK[lang] || KVKK.en;
  return { ...k, text: k.text.replace('{name}', name || 'Mariam Coffee') };
};

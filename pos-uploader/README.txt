MARIAM COFFEE - POS UPLOADER
============================

What it does
  Every 30 minutes it copies the ASEAL sales tables (Invoices.DB, StockTransDetails.DB,
  CROldInvoices.DB, CROldDetails.DB, CRInvoices.DB, CRDetails.DB, Items.DB) and uploads
  them to the Mariam Coffee website, so the sales reports are always up to date.
  It only uploads when the sales changed. It only reads the ASEAL files, it never changes them.

Install (on the POS computer, once)
  1. Unzip this folder somewhere it can stay, e.g. C:\MariamCoffeeUploader
  2. Double-click install.bat
  3. It looks for the ASEAL database by itself. If it asks, choose the folder that holds Invoices.DB.
  4. It uploads once straight away and shows the result.

Other buttons
  upload-now.bat   upload now and show the result
  uninstall.bat    stop the automatic upload
  upload-log.txt   what happened on each upload

Security
  config.json holds this computer's upload key. It can only upload sales data; it cannot read anything.
  If the computer is lost or replaced, make a new key in the website: Settings > POS automatic upload.


مريم كافيه - برنامج رفع المبيعات من جهاز نقطة البيع
===================================================

ماذا يفعل
  كل 30 دقيقة ينسخ جداول مبيعات ASEAL ويرفعها إلى موقع مريم كافيه، فتبقى تقارير المبيعات محدثة.
  يرفع فقط عند تغيّر المبيعات، ويقرأ ملفات ASEAL دون تعديلها.

التثبيت (مرة واحدة على جهاز نقطة البيع)
  1. فك ضغط هذا المجلد في مكان ثابت، مثلاً C:\MariamCoffeeUploader
  2. اضغط مرتين على install.bat
  3. يبحث البرنامج عن قاعدة بيانات ASEAL بنفسه. إذا سألك، اختر المجلد الذي يحتوي على Invoices.DB
  4. يرفع البيانات مرة واحدة فوراً ويعرض النتيجة.

ملفات أخرى
  upload-now.bat   رفع فوري وعرض النتيجة
  uninstall.bat    إيقاف الرفع التلقائي
  upload-log.txt   سجل عمليات الرفع

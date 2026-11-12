// English / Arabic for every account. English is the default.
// The pages are written in English; when Arabic is chosen, the visible texts (and placeholders, titles,
// labels) are swapped for their Arabic version from the dictionary below, and the layout turns right-to-left.
// Names, amounts and anything not in the dictionary stay as they are.

const AR = {
  'Day-to-day costs': 'المصاريف اليومية',
  'What did you buy?': 'ماذا اشتريت؟',
  'Amount (TL)': 'المبلغ (ليرة)',
  'Category (optional)': 'الفئة (اختياري)',
  'Not sure': 'لست متأكداً',
  'Receipt photo (optional)': 'صورة الإيصال (اختياري)',
  'Note (optional)': 'ملاحظة (اختياري)',
  'Send for approval': 'إرسال للموافقة',
  'Sending…': 'جارٍ الإرسال…',
  'Waiting for approval': 'بانتظار الموافقة',
  'Approved': 'تمت الموافقة',
  'Not approved': 'مرفوض',
  'Cancelled': 'ملغى',
  'Barista costs': 'مصاريف الباريستا',
  'Approve': 'موافقة',
  'Reject': 'رفض',
  'Paid from': 'دُفع من',
  'Nothing waiting.': 'لا شيء بالانتظار.',
  'Show categories': 'إظهار الفئات',
  'Per-day spending': 'الصرف اليومي',
  'Per-day by category': 'الصرف اليومي حسب الفئة',
  'Categories': 'الفئات',
  'all': 'الكل',
  'none': 'لا شيء',
  'Tick at least one category.': 'اختر فئة واحدة على الأقل.',
  'Day': 'اليوم',
  'Month': 'الشهر',
  // shell & sign-in
  'Loading…': 'جارٍ التحميل…', 'Mariam Coffee': 'مريم كافيه', 'Staff': 'الموظفون', '👤 Staff sign-in': '👤 دخول الموظفين', 'Staff sign-in': 'دخول الموظفين',
  'Staff and owner sign-in': 'دخول الموظفين والمالك', '← Sales reports': '← تقارير المبيعات', 'Sign out': 'تسجيل الخروج', 'Your account': 'حسابك',
  'Sign in': 'تسجيل الدخول', 'Use the username and password you were given.': 'استخدم اسم المستخدم وكلمة المرور التي حصلت عليها.',
  'Username': 'اسم المستخدم', 'Password': 'كلمة المرور', 'Forgot your password?': 'نسيت كلمة المرور؟', 'Reset your password': 'إعادة تعيين كلمة المرور',
  'Enter your username or email address. We email you a link to choose a new password.': 'أدخل اسم المستخدم أو البريد الإلكتروني، وسنرسل لك رابطاً لاختيار كلمة مرور جديدة.',
  'Send the link': 'إرسال الرابط', 'Sending…': 'جارٍ الإرسال…', 'Signing in…': 'جارٍ تسجيل الدخول…', 'Username or email': 'اسم المستخدم أو البريد الإلكتروني',
  'Password saved': 'تم حفظ كلمة المرور', 'Go to sign-in': 'الذهاب إلى تسجيل الدخول', 'Save password': 'حفظ كلمة المرور', 'Checking the link…': 'جارٍ التحقق من الرابط…',
  'Choose a new password': 'اختر كلمة مرور جديدة', 'Welcome! Choose your password': 'أهلاً بك! اختر كلمة المرور', 'The same password again': 'أعد كتابة كلمة المرور',
  'New password (6+ characters)': 'كلمة المرور الجديدة (6 أحرف على الأقل)', 'Change my password': 'تغيير كلمة المرور', 'Save new password': 'حفظ كلمة المرور الجديدة',
  'Current password': 'كلمة المرور الحالية', 'Password you were given': 'كلمة المرور التي حصلت عليها', 'Password changed.': 'تم تغيير كلمة المرور.',
  'Before you start, please choose your own password. Only you will know it.': 'قبل البدء، اختر كلمة المرور الخاصة بك. لن يعرفها أحد غيرك.',
  'Language': 'اللغة', 'Wrong username or password.': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  // sections
  'Sales reports': 'تقارير المبيعات', 'Clock in / out': 'الحضور والانصراف', 'Accounting': 'المحاسبة', 'Finance': 'المالية', 'Schedule': 'جدول العمل',
  'Timesheets': 'سجل الدوام', 'Team': 'الفريق', 'Salaries': 'الرواتب', 'Monthly hours': 'الساعات الشهرية', 'Settings': 'الإعدادات', 'Sections': 'الأقسام',
  'Owner': 'المالك', 'Accountant': 'محاسب', 'Manager': 'مدير', 'Barista': 'باريستا',
  // clock
  'Clocked in': 'مسجّل حضور', 'Not clocked in': 'غير مسجّل حضور', 'Clock in': 'تسجيل الحضور', 'Clock out': 'تسجيل الانصراف', 'No shift today': 'لا توجد وردية اليوم',
  'Finding your location…': 'جارٍ تحديد موقعك…', 'Clocking in…': 'جارٍ تسجيل الحضور…', 'Clocking out…': 'جارٍ تسجيل الانصراف…',
  'My next shifts': 'ورديّاتي القادمة', 'Next 2 weeks.': 'الأسبوعان القادمان.', 'No shifts planned yet.': 'لا توجد ورديات بعد.', 'My recent hours': 'ساعاتي الأخيرة',
  'Last 7 days:': 'آخر 7 أيام:', 'corrected': 'مُصحّح', 'No clock-ins yet.': 'لا يوجد تسجيل حضور بعد.', 'Today': 'اليوم', 'Try again': 'حاول مرة أخرى',
  'The owner has not set the café location yet, so clocking in is not possible. Please tell the owner.': 'لم يحدد المالك موقع المقهى بعد، لذا لا يمكن تسجيل الحضور. يرجى إخبار المالك.',
  // schedule
  'Tap a shift to change or remove it, or ＋ to add one. Baristas see their own shifts when they sign in.': 'اضغط على وردية لتعديلها أو حذفها، أو على ＋ لإضافة وردية. يرى كل باريستا ورديّاته عند تسجيل الدخول.',
  '‹ Prev': '‹ السابق', 'This week': 'هذا الأسبوع', 'Next ›': 'التالي ›', '✨ Create automatically': '✨ إنشاء تلقائي', 'Copy last week': 'نسخ الأسبوع الماضي',
  'Clear week': 'مسح الأسبوع', 'Print': 'طباعة', '✉ Email each barista their shifts': '✉ إرسال الورديات لكل باريستا بالبريد', 'On shift': 'في الوردية',
  'Add a shift': 'إضافة وردية', 'Change shift': 'تعديل الوردية', 'Date': 'التاريخ', 'Start': 'البداية', 'End': 'النهاية', 'Quick times': 'أوقات سريعة',
  'Same shift on other days this week': 'نفس الوردية في أيام أخرى هذا الأسبوع', 'Note (optional)': 'ملاحظة (اختياري)', 'Add shift': 'إضافة الوردية',
  'Remove shift': 'حذف الوردية', 'Save': 'حفظ', 'Close': 'إغلاق', 'Cancel': 'إلغاء', 'Hours': 'الساعات', 'Barista': 'الباريستا',
  'General rules (every week)': 'قواعد عامة (كل أسبوع)', 'Read and save general rules': 'قراءة القواعد العامة وحفظها', 'Read conditions': 'قراءة الشروط',
  '＋ Add a condition': '＋ إضافة شرط', 'How to write conditions': 'كيف تكتب الشروط', 'Not understood (rephrase or add by hand):': 'لم يُفهم (أعد الصياغة أو أضفه يدوياً):',
  'Create schedule': 'إنشاء الجدول', 'Proposed schedule': 'الجدول المقترح', 'Check:': 'للتحقق:', 'Orders': 'الطلبات', 'Staff hours': 'ساعات الموظفين',
  'Save as this week’s schedule': 'حفظ كجدول هذا الأسبوع', 'You can still change single shifts afterwards.': 'يمكنك تعديل أي وردية لاحقاً.',
  'enough baristas': 'عدد كافٍ', 'short': 'نقص', 'more than needed': 'أكثر من اللازم', 'Opening hours': 'ساعات العمل', 'Open': 'مفتوح',
  'Settings: orders per barista, overlap, shift length, opening hours': 'الإعدادات: الطلبات لكل باريستا، التداخل، طول الوردية، ساعات العمل',
  'Orders one barista handles per hour': 'عدد الطلبات التي يخدمها باريستا في الساعة', 'Minimum baristas while open': 'أقل عدد من الباريستا أثناء العمل',
  'Overlap at hand-over (minutes)': 'التداخل عند التسليم (دقائق)', 'Shortest shift (hours)': 'أقصر وردية (ساعات)', 'Longest shift (hours)': 'أطول وردية (ساعات)',
  'Most hours per barista per week': 'أقصى ساعات للباريستا أسبوعياً', 'Most days per barista per week': 'أقصى أيام للباريستا أسبوعياً',
  'Day off': 'يوم عطلة', 'Can only work between': 'يعمل فقط بين', 'Must work (fixed shift)': 'يجب أن يعمل (وردية ثابتة)', 'Add baristas in Team first.': 'أضف الباريستا في صفحة الفريق أولاً.',
  'None: everyone can work any time, up to the limits below.': 'لا يوجد: يمكن للجميع العمل في أي وقت ضمن الحدود أدناه.',
  'Use the hours from the sales again': 'استخدام الساعات من المبيعات مرة أخرى',
  // timesheets
  'Attendance': 'الحضور', 'In the café now:': 'في المقهى الآن:', 'Per barista': 'لكل باريستا', 'Shifts and clock-ins': 'الورديات وتسجيلات الحضور',
  '＋ Add a record by hand': '＋ إضافة سجل يدوياً', 'Shift': 'الوردية', 'In': 'دخول', 'Out': 'خروج', 'Worked': 'ساعات العمل', 'Late (min)': 'التأخير (دقيقة)',
  'Shifts': 'الورديات', 'Scheduled': 'المجدول', 'Times late': 'مرات التأخير', 'Late minutes': 'دقائق التأخير', 'No-shows': 'الغياب', 'No clock-out': 'بدون تسجيل انصراف',
  'Unscheduled': 'غير مجدول', 'Rate / hour': 'الأجر / ساعة', 'Pay': 'الأجر', 'On time': 'في الوقت', 'No-show': 'غياب', 'In the café now': 'في المقهى الآن',
  'Correct': 'تصحيح', 'Add times': 'إضافة الأوقات', 'Reason (required)': 'السبب (مطلوب)', 'Delete record': 'حذف السجل', 'Correction note': 'ملاحظة التصحيح',
  // team
  'Team and accounts': 'الفريق والحسابات', 'Baristas': 'الباريستا', 'Show removed': 'عرض المحذوفين', '＋ Add a person': '＋ إضافة شخص', 'Name': 'الاسم',
  'Roles': 'الصلاحيات', 'Email': 'البريد الإلكتروني', 'Phone': 'الهاتف', 'Since': 'منذ', 'Edit': 'تعديل', 'Remove': 'حذف', 'Bring back': 'إعادة',
  '✉ Invite everyone': '✉ دعوة الجميع', '✉ Invite all baristas': '✉ دعوة كل الباريستا', '✉ Invite / reset': '✉ دعوة / إعادة تعيين', 'removed': 'محذوف',
  'not signed in yet': 'لم يسجّل الدخول بعد', 'Create account': 'إنشاء الحساب', 'Paid': 'مدفوع', 'Per hour': 'بالساعة', 'Monthly salary': 'راتب شهري',
  'Not on payroll': 'ليس على كشف الرواتب', 'Hourly rate (TL)': 'أجر الساعة (ليرة)', 'Monthly salary (TL)': 'الراتب الشهري (ليرة)', 'Colour on the schedule': 'اللون في الجدول',
  'Email (for the welcome email)': 'البريد الإلكتروني (لرسالة الترحيب)', 'Phone (optional)': 'الهاتف (اختياري)', 'Done': 'تم',
  // salaries
  'Employee': 'الموظف', 'Days': 'الأيام', 'Salary earned': 'الراتب المستحق', 'Advances': 'السلف', 'Salary paid': 'الراتب المدفوع', 'Still to pay': 'المتبقي للدفع',
  'Planned payments': 'دفعات مخططة', 'Month': 'الشهر', 'Other people paid this month': 'أشخاص آخرون دُفع لهم هذا الشهر', 'Records': 'السجلات', 'Planned': 'مخطط',
  // accounting
  '＋ New record': '＋ سجل جديد', 'Edit record': 'تعديل السجل', 'Accounts & categories': 'الحسابات والفئات', 'Upload files': 'رفع الملفات', 'New accounting record': 'سجل محاسبي جديد',
  'Bills, purchases, salaries and advances. Paid now, to be paid on a date, or unpaid.': 'فواتير ومشتريات ورواتب وسلف: مدفوعة الآن، أو تُدفع في تاريخ محدد، أو غير مدفوعة.',
  'What is it for?': 'مقابل ماذا؟', 'Category': 'الفئة', 'Choose…': 'اختر…', '＋ New category…': '＋ فئة جديدة…', 'New category': 'فئة جديدة', 'Add': 'إضافة',
  'Amount (TL)': 'المبلغ (ليرة)', 'Transfer fees (TL, optional)': 'رسوم التحويل (ليرة، اختياري)', 'Expense date': 'تاريخ المصروف', 'Payment': 'الدفع',
  'To be paid on a date': 'يُدفع في تاريخ محدد', 'Unpaid, no date yet': 'غير مدفوع، بدون تاريخ', 'Paid from': 'دُفع من', '＋ New account or loan…': '＋ حساب أو قرض جديد…',
  'Payment date': 'تاريخ الدفع', 'New account': 'حساب جديد', 'To be paid on': 'يُدفع في', 'Type': 'النوع', 'Which loan is paid back?': 'أي قرض يتم سداده؟',
  'Paid to (company or person)': 'دُفع إلى (شركة أو شخص)', 'Kind of payee': 'نوع المستفيد', 'Employee (salary or advance)': 'الموظف (راتب أو سلفة)',
  'Paid by (who handled it)': 'دفعه (من قام بالدفع)', 'Notes (optional)': 'ملاحظات (اختياري)', 'Receipt or invoice photo (optional)': 'صورة الإيصال أو الفاتورة (اختياري)',
  '📷 Take photo': '📷 التقاط صورة', 'Choose photo': 'اختيار صورة', 'Current photo': 'الصورة الحالية', 'Add record': 'إضافة السجل', 'Save changes': 'حفظ التغييرات',
  'Regular': 'عادي', 'Paying an old debt': 'سداد دين قديم', 'Advance (avans) to an employee': 'سلفة لموظف', 'Paying back a loan': 'سداد قرض',
  'Cash': 'نقداً', 'Bank': 'بنك', 'Loan from a person': 'قرض من شخص', 'Bank loan / credit': 'قرض بنكي / بطاقة ائتمان',
  'What': 'البيان', 'Amount': 'المبلغ', 'Status': 'الحالة', 'Paid to': 'دُفع إلى', 'Paid by': 'دفعه', 'Receipt': 'الإيصال', 'View': 'عرض', 'Mark paid': 'تحديد كمدفوع',
  'This month': 'هذا الشهر', 'Last month': 'الشهر الماضي', 'Last 90 days': 'آخر 90 يوماً', 'All': 'الكل', 'From': 'من', 'To': 'إلى', 'Unpaid, no date': 'غير مدفوع، بدون تاريخ',
  'no date': 'بدون تاريخ', 'By category': 'حسب الفئة', 'By paid from': 'حسب مصدر الدفع', 'By paid to': 'حسب المستفيد', 'Loans': 'القروض', 'Loan': 'القرض', 'Kind': 'النوع',
  'Payments made with it': 'دفعات تمت به', 'Borrowed': 'المُقترض', 'Paid back': 'المُسدّد', 'Still owed': 'المتبقي', 'Record a repayment': 'تسجيل سداد',
  'Paid from (money accounts)': 'مصادر الدفع (الحسابات)', 'Account': 'الحساب', 'Paid this month': 'المدفوع هذا الشهر', 'Rename': 'إعادة تسمية', 'Hide': 'إخفاء', 'Show': 'إظهار',
  'Categories': 'الفئات', 'Stock': 'مخزون', 'Shown': 'ظاهر', 'Import from Notion': 'استيراد من Notion', 'Choose CSV file': 'اختيار ملف CSV', 'Import': 'استيراد',
  'Upload an expenses file': 'رفع ملف مصاريف', '⤒ Choose a file': '⤒ اختيار ملف', 'Uploaded files': 'الملفات المرفوعة', 'File': 'الملف', 'Uploaded': 'تاريخ الرفع', 'By': 'بواسطة',
  'Records imported': 'السجلات المستوردة', 'No files uploaded yet.': 'لا توجد ملفات مرفوعة بعد.', 'Unpaid': 'غير مدفوع', 'Delete': 'حذف', 'Search': 'بحث', 'Name…': 'الاسم…',
  '⬇ Export CSV': '⬇ تصدير CSV', 'Clear filters': 'مسح الفلاتر', 'Total': 'المجموع', 'Late': 'متأخر', 'To pay': 'للدفع',
  // finance
  'Month by month': 'شهراً بشهر', 'Tap a month to open it.': 'اضغط على شهر لفتحه.', 'Late from earlier months': 'متأخر من أشهر سابقة', 'Key takeaways': 'أهم الملاحظات',
  '5 recommendations': '5 توصيات', '✨ Ask AI': '✨ اسأل الذكاء الاصطناعي', '↻ Ask AI again': '↻ اسأل مرة أخرى', 'Thinking…': 'جارٍ التفكير…', 'Nothing paid this month yet.': 'لم يُدفع شيء هذا الشهر بعد.',
  'Cash, banks and loans used.': 'النقد والبنوك والقروض المستخدمة.', 'All payments made this month.': 'كل الدفعات هذا الشهر.', 'Due earlier and still not paid.': 'مستحق سابقاً ولم يُدفع بعد.',
  'Planned payments with a due date in this month, paid or not.': 'الدفعات المخططة المستحقة هذا الشهر، مدفوعة أو لا.',
  'Spending by expense date (loan repayments left out).': 'المصاريف حسب تاريخها (دون سداد القروض).',
  // settings
  'Café location for clock-in': 'موقع المقهى لتسجيل الحضور', 'Save location': 'حفظ الموقع', '📍 Use my current location': '📍 استخدام موقعي الحالي', 'Allowed distance (metres)': 'المسافة المسموحة (متر)',
  'Activity log': 'سجل النشاط', 'When': 'متى', 'Who': 'من', 'Details': 'التفاصيل', 'Send a test email to me': 'إرسال بريد تجريبي إليّ',
  // sales reports (main labels)
  'Dashboard': 'لوحة المعلومات', 'Sales per month': 'المبيعات الشهرية', 'Sales per day': 'المبيعات اليومية', 'Sales per hour': 'المبيعات بالساعة', 'Products': 'المنتجات',
  'Profit & costs': 'الربح والتكاليف', 'Net profit': 'صافي الربح', 'Reconciliation': 'المطابقة', 'Period': 'الفترة', '7 days': '7 أيام', '30 days': '30 يوماً', '90 days': '90 يوماً',
  'This year': 'هذه السنة', '12 months': '12 شهراً', 'Start date': 'تاريخ البداية', 'End date': 'تاريخ النهاية', 'Include': 'تضمين', 'Exclude': 'استبعاد', 'Only these': 'هذه فقط',
  'Data source': 'مصدر البيانات', 'Day ends at': 'نهاية اليوم', 'Closing': 'الإغلاق', 'Midnight': 'منتصف الليل', 'Discount': 'الخصم', 'All orders': 'كل الطلبات',
  'After discount': 'بعد الخصم', 'Before discount': 'قبل الخصم', 'Gross profit': 'الربح الإجمالي', '⤒ Update data': '⤒ تحديث البيانات',
  'Recipe costs': 'تكلفة الوصفات', 'Money spent': 'المبالغ المصروفة', 'Net margin': 'هامش الربح الصافي',
  'Mon': 'الإثنين', 'Tue': 'الثلاثاء', 'Wed': 'الأربعاء', 'Thu': 'الخميس', 'Fri': 'الجمعة', 'Sat': 'السبت', 'Sun': 'الأحد',
  'The time comes from the server.': 'الوقت يُؤخذ من الخادم.', 'Not clocked in': 'غير مسجّل حضور',
  '⇄ Ask to swap': '⇄ طلب تبديل', 'Cancel swap': 'إلغاء التبديل', 'Who should take it?': 'من يأخذ الوردية؟', 'Anyone': 'أي شخص', 'Send request': 'إرسال الطلب',
  'Shift swaps': 'تبديل الورديات', 'Accept': 'قبول', 'Decline': 'رفض', 'Approve': 'موافقة', 'Reject': 'رفض', 'Waiting for the manager.': 'بانتظار موافقة المدير.',
  'Colleagues asking you to take a shift. After you accept, a manager approves it.': 'زملاء يطلبون منك أخذ وردية. بعد قبولك يوافق المدير.',
  'Baristas agreed to swap these shifts. Approve to move the shift.': 'اتفق الباريستا على تبديل هذه الورديات. وافق لنقل الوردية.',
  'Waiting for you': 'بانتظارك', 'Waiting for the colleague': 'بانتظار الزميل', 'Approved': 'تمت الموافقة', 'Not approved': 'لم تتم الموافقة', 'Declined': 'مرفوض',
  'Payslip': 'قسيمة الراتب', 'Reopen': 'إعادة فتح', 'POS automatic upload': 'الرفع التلقائي من جهاز نقطة البيع', '⬇ Download the POS program': '⬇ تنزيل برنامج نقطة البيع',
  'Remove the key': 'حذف المفتاح', 'Email': 'البريد الإلكتروني',
  // pieces of headings
  'Finance ·': 'المالية ·', 'Key takeaways ·': 'أهم الملاحظات ·', 'Due in': 'مستحق في', 'Paid out in': 'المدفوع في', 'Plan': 'تخطيط', 'like this month': 'مثل هذا الشهر',
  'Salaries ·': 'الرواتب ·', 'Monthly hours ·': 'الساعات الشهرية ·', ', by account': '، حسب الحساب', ', by category': '، حسب الفئة', 'Late, from before': 'متأخر، من قبل',
  'Payments due this month, what is late, and what was paid out. Add or correct records in': 'الدفعات المستحقة هذا الشهر، والمتأخرة، وما تم دفعه. أضف السجلات أو صحّحها في',
  'Each payment counts in the month it is due (or, if it had no due date, the month it was paid).': 'تُحسب كل دفعة في شهر استحقاقها (أو في شهر دفعها إن لم يكن لها تاريخ استحقاق).',
  'From this month’s figures.': 'من أرقام هذا الشهر.', 'Copy this month’s planned payments to next month': 'نسخ دفعات هذا الشهر المخططة إلى الشهر القادم',
  'Week of': 'أسبوع', 'Automatic schedule · week of': 'جدول تلقائي · أسبوع', 'Conditions for this week': 'شروط هذا الأسبوع', 'Conditions used': 'الشروط المستخدمة',
  'Records': 'السجلات', 'Hourly staff: worked hours from the timesheets × hourly rate. Monthly staff: their monthly salary. Advances and salary payments come from Accounting (records with the employee’s name). Set pay in': 'الموظفون بالساعة: ساعات العمل من سجل الدوام × أجر الساعة. الموظفون الشهريون: راتبهم الشهري. السلف ودفعات الرواتب من المحاسبة (السجلات باسم الموظف). حدّد الأجر في',
  'Days and hours worked per employee, from the timesheets.': 'أيام وساعات العمل لكل موظف من سجل الدوام.',
  'Each person signs in with their own username and password.': 'يسجّل كل شخص الدخول باسم المستخدم وكلمة المرور الخاصة به.',
  'Scheduled shifts compared with clock-in and clock-out. On time = within 5 minutes.': 'الورديات المجدولة مقارنة بتسجيل الحضور والانصراف. في الوقت = خلال 5 دقائق.',
  '📍 Your phone’s location is checked once when you tap. You must be inside': '📍 يتم التحقق من موقع هاتفك مرة واحدة عند الضغط. يجب أن تكون داخل',
};

// texts with a changing part
const PATTERNS = [
  [/^Spending per day · (.+)$/, (m) => `الصرف اليومي · ${m[1]}`],
  [/^Barista costs · (\d+) waiting$/, (m) => `مصاريف الباريستا · ${m[1]} بالانتظار`],
  [/^The most is (\d+) TL per purchase\.$/, (m) => `الحد الأقصى ${m[1]} ليرة لكل عملية شراء.`],
  [/^Paid for something for the café \(milk, ice, cleaning things…\)\? Add it here, up to (\d+) TL per purchase\. The accountant approves it\.$/, (m) => `دفعت ثمن شيء للمقهى (حليب، ثلج، مواد تنظيف…)؟ أضفه هنا، حتى ${m[1]} ليرة لكل عملية شراء. يوافق عليه المحاسب.`],
  [/^Mariam Coffee · (.+)$/, (m, t) => `مريم كافيه · ${t(m[1])}`],
  [/^Signed in as (.+)$/, (m) => `تم الدخول باسم ${m[1]}`],
  [/^Week of (.+)$/, (m) => `أسبوع ${m[1]}`],
  [/^Finance · (.+)$/, (m) => `المالية · ${m[1]}`],
  [/^Key takeaways · (.+)$/, (m) => `أهم الملاحظات · ${m[1]}`],
  [/^Salaries · (.+)$/, (m) => `الرواتب · ${m[1]}`],
  [/^Monthly hours · (.+)$/, (m) => `الساعات الشهرية · ${m[1]}`],
  [/^Due in (.+)$/, (m) => `مستحق في ${m[1]}`],
  [/^Paid out in (.+)$/, (m) => `المدفوع في ${m[1]}`],
  [/^Records \((\d+)\)$/, (m) => `السجلات (${m[1]})`],
  [/^To pay \((\d+)\)$/, (m) => `للدفع (${m[1]})`],
  [/^(\d+) rows$/, (m) => `${m[1]} صفاً`],
  [/^since (.+)$/, (m) => `منذ ${m[1]}`],
  [/^Today: (.+)$/, (m) => `اليوم: ${m[1]}`],
  [/^Import (\d+) records$/, (m) => `استيراد ${m[1]} سجلاً`],
  [/^(\d+) bills$/, (m) => `${m[1]} فواتير`],
  [/^(\d+) payments$/, (m) => `${m[1]} دفعة`],
];

const MONTHS_AR = { Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو', Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر' };
const DAYS_AR = { Mon: 'الإثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة', Sat: 'السبت', Sun: 'الأحد' };
const DATEY = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}|\d{2})\b|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/;

function translate(text) {
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
  const core = text.trim();
  if (!core) return text;
  if (AR[core]) return lead + AR[core] + trail;
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(core);
    if (m) return lead + fn(m, (x) => AR[x] || x) + trail;
  }
  if (DATEY.test(core)) {
    return lead + core.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (x) => MONTHS_AR[x]).replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, (x) => DAYS_AR[x]) + trail;
  }
  return null;
}

// ---------- applying it to the page ----------
const original = new WeakMap(); // text node -> English text
const ATTRS = ['placeholder', 'title', 'aria-label'];
let observer = null;
let current = 'en';

function skip(el) { return !el || el.closest?.('[data-no-i18n], script, style, textarea, code'); }

function doText(node) {
  if (skip(node.parentElement)) return;
  const now = node.nodeValue;
  const prevEn = original.get(node);
  // React may have put new English text in; remember it
  const en = prevEn != null && translate(prevEn) === now ? prevEn : now;
  original.set(node, en);
  const ar = translate(en);
  if (ar != null && ar !== now) node.nodeValue = ar;
}
function doAttrs(el) {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const key = 'data-en-' + a;
    const stored = el.getAttribute(key);
    const en = stored != null && translate(stored) === v ? stored : v;
    el.setAttribute(key, en);
    const ar = translate(en);
    if (ar != null && ar !== v) el.setAttribute(a, ar);
  }
}
function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
}
function restore(root) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = tw.nextNode())) {
    if (n.nodeType === 3) { const en = original.get(n); if (en != null) n.nodeValue = en; } else for (const a of ATTRS) { const en = n.getAttribute(`data-en-${a}`); if (en != null) n.setAttribute(a, en); }
  }
}

/** True when a language was chosen on this device (then it wins over the account's saved one). */
export function chosenHere() {
  try { return localStorage.getItem('mc-lang') != null; } catch { return false; }
}
export function getLang() {
  try { return localStorage.getItem('mc-lang') === 'ar' ? 'ar' : 'en'; } catch { return 'en'; }
}

export function applyLang(lang, remember = true) {
  current = lang === 'ar' ? 'ar' : 'en';
  if (remember) { try { localStorage.setItem('mc-lang', current); } catch { /* ignore */ } }
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
  if (observer) { observer.disconnect(); observer = null; }
  if (current === 'ar') {
    walk(document.body);
    observer = new MutationObserver((list) => {
      observer.disconnect();
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach((n) => walk(n));
      }
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  } else {
    restore(document.body);
  }
}
export const isArabic = () => current === 'ar';

// Root sets this when someone is signed in, so their choice is remembered on their account.
let saver = null;
export function setLangSaver(fn) { saver = fn; }
export function chooseLang(lang) {
  applyLang(lang, true);
  if (saver) saver(lang);
  window.dispatchEvent(new Event('mc-lang'));
}

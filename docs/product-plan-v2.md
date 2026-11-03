# SpaceX Việt Nam – Agent Hub: Product Plan v2

Ngày cập nhật: 27/10/2026. Trạng thái: đề xuất sản phẩm và triển khai, chờ customer xác nhận các quyết định tại mục 3. Đây không phải biên bản customer đã duyệt hoặc cam kết triển khai production.

Tài liệu này thay thế nội dung Product Plan v1. Giữ mã G1–G11 và 72 mã ticket cũ để truy vết; bổ sung ticket cho các khoảng trống nghiệp vụ. Mọi thay đổi phạm vi, chính sách và tiêu chí nghiệm thu sau này cần có người quyết định, ngày hiệu lực và phiên bản.

## 1. Bối cảnh, vấn đề và mục tiêu sản phẩm

SpaceX Việt Nam là trung tâm tin học giả định, gồm trung tâm chính TP.HCM và năm chi nhánh Quận 1, Thủ Đức, Tân Bình, Bình Thạnh, Quận 7. Đội phát triển gồm một Lead và hai dev phụ. Sản phẩm hỗ trợ tuyển sinh từ lúc tiếp nhận khách đến đăng ký, thanh toán và bàn giao lịch học; không thay thế LMS hoặc phần mềm kế toán tổng hợp.

Giả thuyết cần kiểm chứng: tin nhắn phân tán làm bỏ sót khách; nhân viên khó tra cứu giá/lịch/chỗ chính xác; thu tiền và giữ chỗ chưa đồng bộ; giám đốc thiếu số liệu tin cậy. Customer cần cung cấp quy trình hiện tại và dữ liệu nền để xác nhận vấn đề ưu tiên. Không giả định AI là nguyên nhân chính làm tăng doanh số trước khi đo.

Người dùng: giám đốc trung tâm, giám đốc chi nhánh, tuyển sinh, kế toán, người xếp lịch và giảng viên; khách/học viên qua chat, sau đó qua Student Portal. AI Agent là tài khoản dịch vụ có quyền giới hạn.

### 1.1 Khảo sát và xác nhận nghiệp vụ

Trước khi chốt phạm vi pilot, PM/Lead phỏng vấn đại diện tuyển sinh, kế toán, xếp lịch và giám đốc; quan sát ít nhất một chu trình tư vấn–đăng ký–thu tiền. Thu thập mẫu đã ẩn danh: hội thoại thành công/thất bại, lịch lớp, biểu giá, giao dịch lệch, hủy/chuyển lớp và báo cáo đang dùng.

Đầu ra cần customer duyệt: sơ đồ quy trình hiện tại, ba vấn đề ưu tiên, lượng khách/tin nhắn giờ cao điểm, hệ thống đang có và cách nhập dữ liệu, người mua/người dùng/người nghiệm thu, danh sách tình huống UAT và phạm vi pilot. Mức tăng chuyển đổi/giảm thời gian xử lý chỉ cam kết sau khi có số liệu nền và cửa sổ đo thống nhất.

### 1.2 Goals và bằng chứng nghiệm thu

| Mã | Mục tiêu | Bằng chứng hoàn thành |
| --- | --- | --- |
| G1 | Hộp thư chung, trả lời đúng kênh | Web chat hoạt động hai chiều ở M1; một kênh ngoài đã được cấp quyền ở M2; chống trùng và hiển thị trạng thái gửi/lỗi |
| G2 | Quyền theo vai trò và phạm vi | Kiểm quyền tại Gateway và service; test truy cập trực tiếp, chéo chi nhánh và sai chủ sở hữu |
| G3 | AI hiểu nhu cầu và gợi ý phù hợp | Bộ UAT có nhu cầu thiếu, không có lớp phù hợp, online và chuyển người; đạt ngưỡng mục 11 |
| G4 | Giá/lịch/chỗ đến từ nguồn thật | Câu trả lời truy được đến kết quả công cụ và thời điểm đọc; đặt chỗ kiểm lại dữ liệu mới nhất |
| G5 | Đăng ký và giữ chỗ không bán trùng | Kiểm cạnh tranh chỗ cuối, hết hạn, hủy, retry và tiền về muộn; xác nhận chỉ sau khi chốt chỗ |
| G6 | QR và giao dịch được đối soát | Webhook hợp lệ ghi giao dịch một lần; tiền và đơn được theo dõi riêng; có hàng đợi ngoại lệ |
| G7 | Nhân viên tiếp quản không bị AI chen | Hai nhân viên nhận đồng thời chỉ một người thành công; phản hồi AI đang chạy bị chặn sau tiếp quản |
| G8 | Báo cáo có định nghĩa và đối chiếu | Chỉ số tại mục 8 khớp dữ liệu gốc trên bộ dữ liệu UAT; có mốc đồng bộ gần nhất |
| G9 | Thông báo đúng đối tượng, có truy vết | Một ý định thông báo cho mỗi người/sự kiện; lưu trạng thái nhà cung cấp, retry và lỗi cần xử lý |
| G10 | Quyền riêng tư và audit | Consent theo mục đích; che dữ liệu; thao tác nhạy cảm có audit; xóa/ẩn danh có theo dõi hoàn tất |
| G11 | Chia việc và phát hành kiểm chứng được | Ticket có owner, phụ thuộc, tiêu chí; build/test/migration và rollback có bằng chứng |

## 2. Phạm vi và các mốc sản phẩm

### 2.1 M0 – Nền tảng có đăng nhập thật

IAM, Org, Gateway, quyền backend, Portal dùng phiên thật; Catalog hiện tại được bảo vệ; workflow CI có bằng chứng chạy. Hoàn thiện outbox/idempotency trước khi bật nghiệp vụ phụ thuộc event; có log, metric và trace tối thiểu cho luồng pilot. Chưa gọi M0 hoàn tất khi chỉ có mock role hoặc broker demo.

### 2.2 M1 – Vận hành với nhân viên

Web chat → hộp thư → CRM/consent → nhân viên tra lớp/giá → giữ chỗ → QR → giao dịch → chốt chỗ → xác nhận. Có đăng ký tại quầy/điện thoại, lớp cố định online hoặc tại lớp, chặn bán lớp không đủ điều kiện, tiếp nhận ngoại lệ tiền và hủy lớp. Pilot đề xuất tại một chi nhánh; dữ liệu và quyền vẫn hỗ trợ sáu đơn vị.

M1 giới hạn một đăng ký cho một học viên, một lớp, một gói và một đơn vị chịu trách nhiệm. Mặc định đề xuất: thanh toán đủ một lần bằng QR; không giảm giá, không trả góp. Tiền mặt/chuyển khoản thủ công chỉ bật nếu customer xác nhận quy trình chứng từ và quyền tại C04. Khách trả thiếu/thừa vẫn phải được tiếp nhận như ngoại lệ, dù không bán trả góp.

### 2.3 M2 – AI hỗ trợ và một kênh ngoài

AI triển khai theo ba bước: tạo câu trả lời nháp cho nhân viên; tự trả lời câu hỏi ít rủi ro sau UAT; cuối cùng cho phép đề xuất và tạo giữ chỗ/QR qua Enrollment khi khách xác nhận rõ. Giữ công tắc tắt AI theo toàn hệ thống/chi nhánh/hội thoại. Thêm một kênh Zalo hoặc Facebook tùy quyền thực tế; không cam kết hai kênh khi chưa được cấp quyền.

### 2.4 M3 – Mở rộng vận hành

Danh sách chờ, bảo lưu/chuyển lớp, lịch học bù/thay giảng viên, hoàn tiền và đối soát đầy đủ, dashboard, Instagram/TikTok nếu được cấp quyền, RAG chính sách, đánh giá/chi phí AI và lưu trữ tự động. Nếu một nghiệp vụ như bảo lưu là điều kiện bắt buộc của customer, chuyển ticket tương ứng lên M1 trước khi duyệt scope.

### 2.5 M4 – Student Portal

OTP và quyền xem/thao tác hồ sơ của mình. Trước M4, học viên yêu cầu hỗ trợ qua chat/nhân viên; không quảng bá khả năng tự hủy/đổi lịch nếu chưa có giao diện và backend tương ứng.

Ngoài phạm vi mặc định: LMS, chấm điểm/chứng chỉ, kế toán thuế, học thử, lịch 1 kèm 1, bán bundle nhiều khóa, trả góp tự động, tích hợp hóa đơn điện tử có giá trị pháp lý. Hóa đơn ở đồ án chỉ là bản mô phỏng được ghi rõ. Mọi phát sinh phải được đánh giá ảnh hưởng thời gian và nghiệm thu trước khi thêm.

## 3. Các quyết định customer cần xác nhận

Các mặc định dưới đây giúp đội triển khai bản demo; không đồng nghĩa customer đã đồng ý. PM ghi người duyệt và ngày quyết định vào từng mục. Mục chưa chốt phải hiển thị là hạn chế pilot, hoặc chặn go-live nếu ảnh hưởng luồng chính.

| Mã | Quyết định | Đề xuất tạm thời | Người quyết định / hạn chốt |
| --- | --- | --- | --- |
| C01 | Chi nhánh, người dùng và mục tiêu pilot | Một chi nhánh, web chat, nhân viên xử lý trước | Giám đốc + PM / trước duyệt M1 |
| C02 | Mở bán và sĩ số tối thiểu | Chỉ thu tiền lớp OPEN đủ điều kiện; lớp dự kiến chỉ nhận quan tâm | Giám đốc + người xếp lịch / trước CS-1 |
| C03 | Giữ chỗ và đối soát | 20 phút; tối đa một giữ chỗ còn hiệu lực cho cùng học viên/lớp; REVIEW tối đa thêm 24 giờ, không gia hạn lặp tự động | Tuyển sinh + kế toán / trước CS-4, PAY-3 |
| C04 | Kênh thu tiền, đặt cọc, trả góp | QR trả đủ; chưa thu tiền mặt/ghi nhận thủ công cho tới khi chốt chứng từ và quyền | Kế toán + giám đốc / trước PAY-1 |
| C05 | Hủy, hoàn, bảo lưu, chuyển lớp | Chính sách mục 6.8; nếu chưa có tính năng bảo lưu thì không công bố quyền này trong pilot | Giám đốc + kế toán / trước mở bán |
| C06 | Phân công, ngoài giờ và SLA | Nhận thủ công trong hàng đợi chi nhánh; quá hạn báo quản lý; công bố giờ trực | Trưởng tuyển sinh / trước CV-3 |
| C07 | Người học/người trả tiền và độ tuổi | Tách người liên hệ, học viên, người trả tiền; quan hệ đại diện cần quy trình customer xác nhận | Tuyển sinh + người phụ trách dữ liệu / trước CRM-1 |
| C08 | Giá và doanh thu giữa chi nhánh | Một giá chung; đơn ghi chi nhánh học, chi nhánh tuyển sinh, đơn vị nhận tiền riêng | Giám đốc + kế toán / trước CAT-1, RP-3 |
| C09 | Dữ liệu, consent, retention, chứng từ | Mặc định mục 7; rà soát yêu cầu hiện hành khi triển khai thật | Customer phụ trách dữ liệu / trước pilot thật |
| C10 | Kênh ngoài và nhà cung cấp | payOS sandbox; chọn Zalo hoặc Facebook sau khi kiểm quyền; provider qua adapter | Chủ tài khoản customer + Lead / trước M2 |
| C11 | Tải, giờ hỗ trợ, phục hồi, chi phí | Các ngưỡng dự kiến tại mục 11; đặt ngân sách LLM và hạ tầng cụ thể | Customer + Lead / trước pilot |
| C12 | Nhập dữ liệu và hệ thống đang dùng | Import có đối chiếu; không đồng bộ hai chiều nếu chưa có ticket | Người vận hành + kế toán / trước M1 |

## 4. Mô hình dữ liệu và quyền sở hữu

Giữ ranh giới 13 service như v1, nhưng chỉ dựng service khi có ticket cần triển khai. Đồ án chạy bằng Docker Compose trên một máy, PostgreSQL tách database/user theo service, RabbitMQ, Redis và pgvector khi cần. Dữ liệu giao dịch/chỗ bền vững ở PostgreSQL; Redis không là nguồn duy nhất của chỗ giữ. Không cho service đọc/ghi trực tiếp DB của service khác.

| Service | Dữ liệu và trách nhiệm |
| --- | --- |
| API Gateway/BFF | Điểm vào web, xác thực, định tuyến, rate limit; không sở hữu nghiệp vụ |
| Identity & Access | Tài khoản, credential, phiên, role và quyền truy cập theo phạm vi |
| Org | Đơn vị, chi nhánh, phòng ban, nhân sự và hồ sơ giảng viên; tham chiếu accountId từ IAM |
| Channel Gateway | Adapter kênh, webhook, token kênh, mapping chi nhánh và trạng thái gửi |
| Conversation | Hội thoại, tin nhắn, người phụ trách, chế độ AI/người, phiên bản quyền gửi |
| CRM | Người liên hệ, học viên, quan hệ đại diện, lead, định danh kênh và consent |
| Catalog | Khóa, gói thuộc một khóa, giá chung, chính sách có phiên bản và nội dung RAG |
| Class & Schedule | Lớp, buổi học, phòng, giáo viên đã xếp, sức chứa, hold và quyền sử dụng chỗ |
| Enrollment | Đăng ký, snapshot giá/chính sách, saga, danh sách chờ, chuyển lớp/bảo lưu |
| Payment | Yêu cầu thu, QR, giao dịch bất biến, đối soát, hoàn tiền và adapter hóa đơn |
| AI Agent | Điều phối LLM, tool calling, kiểm an toàn, log đánh giá; không là nguồn giá/lịch/tiền |
| Notification | Ý định thông báo, mẫu có phiên bản, lịch gửi, trạng thái delivery và lỗi |
| Reporting & Audit | Read model báo cáo, nhật ký audit và tiến độ đồng bộ |

### 4.1 Quy ước dữ liệu

ID bất biến, thời gian lưu UTC/hiển thị Asia/Ho_Chi_Minh, tiền VND là số nguyên không âm. Chốt chính xác ngày và giờ địa phương khi xếp lớp. Chi nhánh có trạng thái hoạt động; ngừng hoạt động không xóa dữ liệu cũ. Một học viên không có hai đăng ký đang hiệu lực cho cùng lớp.

Tách contactId, learnerId, payerId và thông tin bên nhận hóa đơn; không tự coi người chat là học viên. Chưa xác minh số điện thoại thì không tự gộp người chỉ vì trùng số; lưu đề xuất trùng để người có quyền kiểm tra. Không gửi lại OTP hoặc thông tin hồ sơ chỉ dựa vào lời khẳng định của người đang chat.

Enrollment lưu courseId/packageId/classId, số tiền phải thu, tiền tệ, phiên bản giá/chính sách, nội dung điều khoản đã chấp nhận, thời điểm và người xác nhận, learnerId/contactId, branch học và nguồn tuyển sinh. Thay giá/chính sách mới chỉ áp dụng đơn mới; sửa đơn cũ phải qua thao tác có quyền và audit.

### 4.2 Quyền và phiên đăng nhập

Gateway và service đều kiểm chữ ký, thời hạn, issuer/audience và quyền của token. Không dùng role/branchIds do client tự gửi để cấp quyền. IAM hỗ trợ đăng xuất, khóa tài khoản và thu hồi phiên; thay đổi quyền phải có cơ chế vô hiệu phiên cũ trong giới hạn được kiểm thử. Token role đơn là phạm vi ban đầu; đa vai trò chỉ thêm khi customer yêu cầu.

| Vai trò | Phạm vi và quyền chính | Giới hạn |
| --- | --- | --- |
| Giám đốc trung tâm | Toàn đơn vị; giá/chính sách; duyệt ngoại lệ; xem audit | Không sửa/xóa audit hoặc sửa trực tiếp giao dịch |
| Giám đốc chi nhánh | Dữ liệu chi nhánh; duyệt lớp/lịch, phân công và ngoại lệ trong hạn mức được giao | Không tự đổi giá chung; không xem chi nhánh khác |
| Tuyển sinh | Khách, hội thoại, lớp và đăng ký trong phạm vi; tạo đơn; xem trạng thái đã thu/còn thiếu để chăm sóc | Không xem sao kê/tài khoản nhạy cảm, duyệt hoàn hoặc tự sửa giá |
| Kế toán | Giao dịch, đối soát, thông tin người trả tiền/hóa đơn cần thiết của chi nhánh | Không đọc chat; không đổi giá hoặc tạo bằng chứng ngân hàng giả |
| Giảng viên | Lớp/buổi được phân công; danh sách học viên tối thiểu; khai báo giờ rảnh/nghỉ | Không xem tài chính hoặc số điện thoại mặc định |
| Học viên | Dữ liệu của mình, qua nhân viên trước M4 và tự phục vụ sau M4 | Kiểm ownership, không chỉ branchId |
| AI Agent | Chỉ khách/hội thoại hiện hành; đọc catalog/lớp; tạo yêu cầu qua Enrollment | Không hoàn, đổi giá, cấp quyền hoặc tra khách khác |

Tạm đề xuất: kế toán lập yêu cầu hoàn; giám đốc có phạm vi phê duyệt; kế toán ghi thực hiện và đính bằng chứng; người lập không tự duyệt. Customer chốt hạn mức/ủy quyền trước PAY-4. Các API duyệt ngoại lệ có lý do và audit. Org quản lý hồ sơ/gán đơn vị; IAM là nơi duy nhất ghi quyền đăng nhập, đồng bộ bằng API/event có retry và báo trạng thái pending nếu thất bại.

## 5. Luồng tiếp nhận và tư vấn

### 5.1 Tin vào, định danh và phân công

1. Channel Gateway kiểm webhook theo adapter hoặc phiên web chat, lưu bền vững và chống trùng theo provider/account/messageId, rồi xác nhận nhận thành công. Không gửi 200 khi chưa lưu được; payload không hợp lệ xử lý theo hợp đồng provider.
2. Phát channel.message_received qua outbox. Conversation gọi CRM tìm/tạo contact theo định danh kênh, lưu tin đúng một lần bằng inbox/idempotency.
3. Tài khoản kênh riêng chi nhánh được gắn theo mapping Org. Kênh chung hỏi khu vực; chưa xác định vào hàng đợi trung tâm. Chuyển chi nhánh giữ lịch sử, kiểm quyền và thông báo người nhận.
4. Nhân viên nhận hội thoại bằng cập nhật nguyên tử: một owner tại một thời điểm. Có nhận, chuyển giao, trả hàng đợi và kết thúc; ghi ai/thời điểm/lý do. Không ai nhận hoặc ngoài giờ thì báo trạng thái chờ rõ ràng, nhắc và escalation theo C06.
5. Web chat có session/reconnect, tải lại lịch sử theo quyền và messageId do client cung cấp để retry không trùng. Không dùng số điện thoại làm khóa truy cập lịch sử. Giới hạn tốc độ/kích thước tin, xử lý lỗi kết nối. MVP chỉ tin văn bản và QR được hệ thống tạo; file/ảnh khách gửi phải có ticket kiểm soát riêng trước khi bật.

### 5.2 Gửi tin và chuyển AI/người

Trạng thái chế độ: HUMAN_QUEUE, HUMAN_ACTIVE, AI_ACTIVE, CLOSED. Owner và chế độ là hai thuộc tính rõ ràng. M1 chỉ dùng chế độ người; M2 mới bật AI. Khách yêu cầu gặp người, phàn nàn, xin ngoại lệ/hoàn tiền, công cụ lỗi hai lần hoặc AI không đủ dữ liệu thì vào HUMAN_QUEUE và báo đúng chi nhánh.

Mỗi lần đổi mode/owner tăng conversationVersion. Tác vụ AI mang version đã đọc; ngay trước khi chấp nhận gửi, Conversation kiểm lại mode/version. Kết quả cũ bị bỏ, kể cả khi LLM đã chạy xong. Gửi nhiều tin liên tiếp được xếp theo hội thoại và dùng message watermark để tránh trả lời dựa trên lịch sử cũ. Nhân viên trả lại AI bằng thao tác chủ động.

Conversation phát conversation.message_out; Channel kiểm cửa sổ trả lời và consent, gửi đúng kênh; lưu queued/sent/delivered/failed/unknown theo khả năng provider. Không đánh đồng gửi API thành công với khách đã đọc. Timeout không rõ kết quả phải tra cứu/idempotency theo provider trước retry; giao diện hiển thị trạng thái chưa xác định. Hết cửa sổ gửi thì báo nhân viên, chỉ chuyển kênh khác nếu có consent phù hợp.

### 5.3 Tìm lớp và AI

Thu thập mục tiêu, trình độ, ngân sách, khung giờ, hình thức, khu vực, ngày bắt đầu; hỏi tối đa hai câu mỗi lượt. Catalog lọc khóa/gói đang bán và ngân sách; Class chỉ trả lớp OPEN, chưa quá hạn đăng ký, đủ lịch/giảng viên/phòng nếu tại lớp, và còn chỗ. Online không lọc khu vực nhưng vẫn có đơn vị chịu trách nhiệm.

Xếp theo khớp giờ, giá, khu vực nếu tại lớp, ngày khai giảng; tối đa ba lựa chọn. Không có thì xin phép nới một điều kiện/lần, nhận quan tâm hoặc chuyển người. Kết quả có thời điểm đọc; giá/chỗ chỉ là thông tin tại thời điểm đó, phải kiểm lại lúc chốt.

RAG chỉ dùng FAQ/mô tả/chính sách đã duyệt có phiên bản; giá/lịch/chỗ lấy API. Tool kiểm quyền độc lập, không tin chỉ dẫn trong chat hoặc nội dung RAG. Chặn số liệu không có nguồn và yêu cầu vượt quyền; không giải quyết bằng cách chỉ yêu cầu model tự kiểm. Dữ liệu định danh thật đi qua backend bằng ID. Có log tool, kết quả đã che, version prompt/model và lý do chuyển người; giới hạn lượt tool, timeout và ngân sách.

## 6. Lớp, đăng ký, thanh toán và các ngoại lệ

### 6.1 Vòng đời lớp và lịch

Trạng thái: DRAFT → PLANNED → OPEN → IN_PROGRESS → COMPLETED; CANCELLED là nhánh kết thúc có xử lý đăng ký. PLANNED nhận quan tâm nhưng không thu tiền theo C02. Chỉ giám đốc chi nhánh được chuyển OPEN sau khi đủ lịch, giảng viên, phòng nếu cần, sức chứa và điều kiện khai giảng. Lưu sĩ số tối thiểu và hạn quyết định; khi chưa đủ, người có quyền quyết định hoãn/hủy/mở ngoại lệ có audit, không âm thầm đổi ngày.

Sức chứa không được giảm dưới số chỗ committed + hold hợp lệ. Lịch có khung giờ, ngày nghỉ, khoảng đệm nếu customer yêu cầu; online kiểm trùng giảng viên, onsite thêm phòng. Chặn bán khi lớp CANCELLED/COMPLETED hoặc quá hạn đăng ký. Không tự cho nhập học giữa khóa; cần ticket/quy tắc riêng nếu customer yêu cầu.

Thay một buổi, thay giảng viên, học bù, đổi hình thức đều lưu version, kiểm xung đột và phát sự kiện. Giảng viên đề nghị nghỉ không đồng nghĩa lịch đã được duyệt. Học viên không thể tham gia lịch mới được đưa vào quy trình xử lý có owner, không chỉ nhận một thông báo.

### 6.2 Giữ chỗ và tạo đăng ký

1. Nhân viên hoặc AI có quyền gửi yêu cầu với idempotencyKey, learnerId, classId/packageId và xác nhận của khách. Retry cùng key/payload trả cùng kết quả; cùng key khác payload bị từ chối.
2. Enrollment tạo PENDING_HOLD. Đọc giá/chính sách được áp dụng từ Catalog kèm version/quote có hạn, lưu snapshot và điều khoản; nếu khác báo giá khách vừa xác nhận thì phải xin xác nhận lại trước khi tạo QR. Catalog là nguồn xác nhận giá, không nhận số tiền do client tự quyết. Class kiểm trạng thái lớp và cấp hold nguyên tử bằng DB transaction/locking. Hết chỗ thì từ chối hoặc đề nghị waitlist; không phát QR.
3. Hold có holdId, learnerId, enrollmentId, expiresAt theo đồng hồ server. Một học viên/lớp chỉ có một hold hiệu lực, hạn chế giữ hàng loạt theo customer/session. Chỗ còn = sức chứa − committed − hold chưa hết hạn, không trừ hai lần cùng hold.
4. Có hold mới chuyển HELD và yêu cầu Payment tạo QR. Lỗi không phục hồi được thì nhả hold và kết thúc đơn theo bù trừ. Lỗi timeout chưa biết kết quả phải tra theo operationId trước khi tạo lại.
5. Hạn QR không dài hơn hold nếu provider hỗ trợ. Nếu không đồng bộ được hạn, thông báo hạn đăng ký và xử lý tiền muộn theo 6.5. Khách hủy trước thu tiền thì hủy QR khi có thể, nhả chỗ ngay.

### 6.3 Trạng thái đăng ký và trạng thái tiền

Hai vòng đời độc lập; không dùng CONFIRMED để diễn đạt chỉ việc nhận tiền.

| Enrollment | Ý nghĩa / chuyển tiếp hợp lệ |
| --- | --- |
| PENDING_HOLD | Đang xin chỗ; thành HELD, WAITLISTED nếu khách chọn, hoặc CANCELLED khi thất bại |
| HELD | Có hold; sang CONFIRMING khi tiền đủ đã đối soát, PAYMENT_REVIEW khi có tiền cần xem xét, EXPIRED khi hết hạn, CANCELLED nếu hủy chưa có tiền |
| PAYMENT_REVIEW | Có ngoại lệ đã xác định được đơn; sang CONFIRMING sau quyết định hợp lệ, hoặc REFUND_PENDING/EXPIRED theo kết quả; hold xử lý độc lập theo hạn |
| CONFIRMING | Đã đủ điều kiện tiền, đang chốt chỗ; sang CONFIRMED chỉ sau Class xác nhận committed; hết chỗ sang REFUND_PENDING hoặc xử lý chuyển lớp có đồng ý |
| CONFIRMED | Có chỗ committed và tiền hợp lệ; sang COMPLETED khi khóa kết thúc, REFUND_PENDING khi hủy có tiền hoàn, CANCELLED khi hủy không hoàn, SUSPENDED/TRANSFER_PENDING khi nghiệp vụ M3 được bật |
| EXPIRED | Hold đã hết; tiền muộn được đánh giá lại, chỉ sang CONFIRMING khi lấy lại chỗ nguyên tử thành công; nếu không thì REFUND_PENDING |
| WAITLISTED | Không giữ chỗ/không QR; được mời thì tạo hold mới có hạn, hoặc CANCELLED |
| SUSPENDED / TRANSFER_PENDING | Chỉ bật khi ENR-6/7 hoàn tất; giữ lý do, thời hạn và đối ứng đơn/chỗ, không sửa lịch sử thu tiền |
| REFUND_PENDING | Đang duyệt/thực hiện hoàn; sang REFUNDED khi đủ số tiền cần hoàn đã được xác minh; nếu từ chối, quay về trạng thái hợp lệ có quyết định/audit |
| CANCELLED / REFUNDED / COMPLETED | Kết thúc luồng thông thường; tiền đến sau vẫn là giao dịch cần xử lý, không bị bỏ qua vì đơn kết thúc |

Payment lưu payment request riêng (CREATING/OPEN/EXPIRED/CANCELLED/SETTLED/REVIEW), giao dịch tiền vào bất biến và refund request riêng. Mỗi yêu cầu có amountDue, tổng tiền hợp lệ đã phân bổ, còn thiếu, thừa và đã hoàn; một đơn có thể có nhiều giao dịch dù MVP không chủ động bán trả góp. QR mới thay QR cũ không tạo thêm khoản phải thu; tiền về từ QR cũ vẫn đi qua cùng quy tắc đối soát.

### 6.4 Nhận tiền và xác nhận chỗ

Webhook kiểm chữ ký/xác thực theo provider, lưu bền vững payload cần thiết đã giới hạn dữ liệu, chống trùng theo transactionId có namespace provider/account; không dedup theo riêng số tiền/mã đơn. Chỉ acknowledge thành công sau khi ghi nhận. Worker đối chiếu tài khoản đích, trạng thái giao dịch, tiền tệ, tham chiếu và số tiền; event chuẩn hóa gồm payment.received, payment.matched hoặc payment.review_required. payment.succeeded của v1 được định nghĩa lại là payment.matched, không đồng nghĩa enrollment.confirmed; khi có consumer cũ cần adapter/version.

Enrollment nhận tiền matched chuyển CONFIRMING, yêu cầu Class commit hold bằng thao tác idempotent và nguyên tử. Class quyết định thắng/thua giữa expire và commit; không dựa vào thứ tự nhận event ở Enrollment. Commit thành công mới chuyển CONFIRMED và phát enrollment.confirmed. Notification xác nhận đăng ký chỉ nghe event này, không nghe payment.matched để khẳng định có chỗ.

Nếu event/response trễ hoặc mất tạm thời, reconciliation worker tra payment/hold theo ID và tiếp tục saga; không hoàn tiền chỉ vì một timeout. UI phân biệt đã nhận tiền/đang xác nhận chỗ/đã xác nhận; mỗi saga có owner kỹ thuật, timeout và cảnh báo quá hạn.

### 6.5 Hết hạn, tiền lệch, trùng và tiền muộn

| Tình huống | Xử lý bắt buộc |
| --- | --- |
| Hết hạn chưa có tiền | Class hết hạn hold nguyên tử; Enrollment EXPIRED; hủy QR khi hỗ trợ; mời lại theo consent, không tự giữ chỗ mới |
| Thiếu/thừa tiền, xác định được đơn | Lưu giao dịch; hàng đợi kế toán; REVIEW có hạn; không tự xác nhận chỗ nếu chưa có quyết định hợp lệ |
| Sai/không có tham chiếu, không tìm được đơn | Giao dịch UNALLOCATED; không tự đổi bất kỳ đăng ký nào; kế toán gán với chứng cứ và audit, ngăn phân bổ một khoản tiền hai lần |
| Webhook gửi lại | Một giao dịch, một hiệu ứng; không thêm tiền hoặc chỗ |
| Khách thực sự chuyển hai lần | Hai giao dịch thật; phân bổ theo khoản phải thu, phần dư vào hàng đợi hoàn/đối soát |
| Tiền về sau hold hết hạn | Thử lấy và commit chỗ nguyên tử nếu lớp còn hợp lệ; nếu không còn chỗ thì đề nghị chuyển có đồng ý hoặc tạo yêu cầu hoàn; không ép bán vượt sức chứa |
| REVIEW quá hạn | Nhả hold; tiền vẫn ở hàng đợi tài chính có owner/escalation. Sau đó muốn xác nhận phải kiểm và lấy lại chỗ |
| Tiền về sau hủy/hoàn/kết thúc | Ghi nhận giao dịch mới và xử lý kế toán; không tự mở lại đơn kết thúc |
| Nhà cung cấp/webhook lỗi | Đánh dấu chờ; poll/đối chiếu nguồn hợp lệ theo khả năng provider; ảnh chụp chuyển khoản không tự xác nhận tiền |

Kế toán gán/đối soát không được giả lập một webhook ngân hàng. Giao dịch thủ công nếu bật theo C04 phải có nguồn riêng, người nhập, chứng từ và người duyệt. Bất đồng/không xác minh được chuyển cấp quản lý; có SLA phản hồi khách và mã vụ việc.

### 6.6 Đăng ký tại quầy và thay đổi dữ liệu

Nhân viên tạo contact/learner, ghi consent phù hợp và source=walk_in/phone/referral; dùng cùng Enrollment/Class/Payment, không ghi trực tiếp số chỗ. Chặn đơn trùng cùng học viên/lớp. Sửa tên/liên hệ có quyền và audit; đổi học viên/lớp/gói sau thu tiền phải qua workflow điều chỉnh, không PUT đè snapshot tiền/chính sách.

### 6.7 Hủy lớp, chuyển lớp, bảo lưu và danh sách chờ

Hủy lớp khóa nhận đăng ký mới; nhả HELD, hủy QR khi có thể; đơn có tiền được lập phương án hoàn/chuyển và thông báo. Trung tâm hủy thì đề xuất hoàn 100% hoặc chuyển theo lựa chọn học viên, không áp hạn hoàn thông thường để giảm quyền lợi. Khi quyết định hủy đăng ký có hiệu lực, Enrollment yêu cầu Class nhả chỗ committed đúng một lần; việc nhả chỗ không phải chờ hoàn tiền xong. Thời điểm hủy có hiệu lực được lưu riêng với trạng thái hoàn. Không chuyển thành REFUNDED trước khi thực sự hoàn xong.

Chuyển lớp: kiểm điều kiện chính sách và đồng ý; giữ chỗ đích trước, tính chênh lệch, xác nhận tiền/hoàn nếu cần rồi mới hoàn tất chuyển và nhả chỗ cũ. Saga có bù trừ, thất bại không làm mất chỗ cũ ngoài ý muốn; hai bước commit không có transaction chung phải có trạng thái phục hồi và audit. Chi nhánh khác cần quyền hai bên và quy tắc phân bổ doanh thu C08.

Bảo lưu: lưu số buổi/quyền lợi còn lại, hạn sử dụng, lần đã dùng và người duyệt; nhả chỗ theo chính sách, không cam kết chỗ lớp tương lai khi chưa giữ. Customer chốt tính theo buổi đã diễn ra hay điểm danh; MVP chưa có attendance thì không quảng bá cách tính dựa trên điểm danh cá nhân.

Danh sách chờ: thứ tự theo thời điểm và tiêu chí ưu tiên được customer duyệt; một lời mời có hạn, tạo hold mới khi phù hợp, hết hạn chuyển người tiếp theo. Không có QR/giữ chỗ vĩnh viễn cho mọi người chờ.

### 6.8 Chính sách đề xuất, có phiên bản

Giữ chính sách gốc làm đề xuất: trước khai giảng hoàn 100%; sau khai giảng và trước buổi thứ ba hoàn phần buổi chưa diễn ra theo cách tính được C05 chốt; từ buổi thứ ba không hoàn thông thường, đề xuất bảo lưu/chuyển một lần nếu tính năng và điều kiện đã được duyệt; trung tâm hủy hoàn 100% hoặc chuyển theo lựa chọn khách. Cần chốt giờ ranh giới, buổi bị hủy/học bù, ngày nghỉ, làm tròn VND và hạn thực hiện hoàn. Không tính khác nhau giữa các service.

Catalog lưu version và effectiveAt; Enrollment lưu snapshot. Kế toán lập yêu cầu hoàn với số tiền, lý do, đơn/giao dịch và bằng chứng; người có quyền duyệt độc lập; thực hiện thủ công ở đồ án và lưu mã chuyển khoản. Tổng hoàn không vượt tổng tiền đã nhận có thể hoàn trừ các khoản đã hoàn trước. Retry không hoàn hai lần; yêu cầu một phần và toàn bộ có trạng thái riêng. REFUNDED của Enrollment nghĩa là đã hoàn đủ khoản được duyệt để kết thúc đăng ký, có thể thấp hơn học phí theo chính sách. Hoàn tiền dư/điều chỉnh giao dịch mà học viên vẫn học không tự chuyển Enrollment CONFIRMED sang REFUNDED hoặc nhả chỗ. Chi tiết chính sách chưa duyệt phải chặn mở bán, không để AI tự quyết.

## 7. Thông báo, dữ liệu cá nhân và audit

Thông báo gồm xác nhận đăng ký, chuyển giao, thay lịch/hủy lớp, nhắc học, kết quả đối soát/hoàn. Unique key theo loại sự kiện + entity/version + recipient; tạo ý định một lần, delivery có thể retry. Không cam kết exactly-once ngoài hệ thống khi provider không hỗ trợ; lưu providerMessageId và trạng thái unknown để tránh retry mù. Notification có retry/backoff/DLQ và màn hình/lệnh xử lý lại có quyền; kênh thất bại báo nhân viên theo SLA.

Consent lưu mục đích, nội dung/version, nguồn, thời điểm, người xác nhận và thu hồi. Phân biệt liên hệ phục vụ đăng ký với marketing; không tự đăng ký marketing. Khách chưa cung cấp consent cần thiết vẫn được tư vấn chung. Thông báo quyền riêng tư xuất hiện trước khi bắt đầu web chat; metadata tối thiểu cần cho tiếp nhận tin, mục đích/căn cứ xử lý và thời hạn của tin trước consent phải được C09 xác nhận, không mặc định tạo hồ sơ marketing từ mọi webhook. Xác minh quan hệ đại diện và yêu cầu truy cập/xóa trước khi lộ hoặc xóa dữ liệu; quy trình phù hợp độ tuổi phải được customer duyệt nếu có học viên chưa thành niên.

Che PII trước LLM, log và analytics; bí mật kênh/nhà cung cấp không đưa vào prompt/frontend. Link buổi online chỉ cấp cho CONFIRMED, kiểm quyền khi truy cập; thu hồi/đổi link khi cần. Kế toán chỉ thấy dữ liệu tối thiểu để xử lý tiền, không đọc chat. Mọi đọc dữ liệu khách nhạy cảm, thay đổi quyền, giá, lịch, đơn, đối soát và hoàn có actor/time/reason/correlationId và thay đổi đã giới hạn PII. Audit không sửa bằng API nghiệp vụ; tách quyền vận hành và có biện pháp phát hiện can thiệp.

Retention đề xuất giữ từ v1: chat không đăng ký 90 ngày từ tin cuối; chat có đăng ký 12 tháng sau khóa kết thúc; log AI đã che 6 tháng. Chứng từ/audit/hóa đơn theo chính sách customer đã được rà soát yêu cầu hiện hành; ở đồ án chưa tự xóa chứng từ. Không mặc định giữ vô thời hạn ở production.

Yêu cầu xóa có requestId, xác minh người yêu cầu, danh sách service, trạng thái từng nơi, retry và hạn xử lý đã thống nhất. CRM ẩn danh phần được phép; giao dịch cần giữ được tách dữ liệu định danh theo chính sách. Xử lý cả log/export/vector index và thời hạn bản sao lưu; phục hồi backup phải áp lại danh sách xóa để không tái xuất hiện dữ liệu. Không ngừng mọi thông báo một cách máy móc nếu còn nghĩa vụ xử lý đơn; phân biệt mục đích và quy tắc đã duyệt. Đây là thiết kế sản phẩm, chưa thay thế rà soát tuân thủ cho triển khai thật.

Hóa đơn đồ án: Payment tạo số/file mô phỏng ghi rõ không có giá trị pháp lý, theo yêu cầu có consent của người trả tiền. Dữ liệu được lấy qua form/backend an toàn, không buộc gửi PII qua LLM. Chỉ phát hành sau giao dịch đủ điều kiện và thông tin đã xác nhận. Customer cần chốt thời điểm, xuất muộn, điều chỉnh sau hoàn; tích hợp thật là phạm vi riêng.

## 8. Báo cáo và định nghĩa chỉ số

Reporting dùng event read model, có checkpoint, lag và khả năng đối chiếu API/export nguồn. Tiền thu không đồng nghĩa doanh thu kế toán; dashboard MVP ghi rõ tên chỉ số. Customer duyệt quy tắc nguồn/chi nhánh trước khi dùng để đánh giá nhân sự.

| Chỉ số | Định nghĩa đề xuất / nguồn |
| --- | --- |
| Lead mới | LeadId mới trong kỳ theo thời điểm tạo; contact cũ có nhu cầu mới theo quy tắc customer, không đếm mỗi tin nhắn là lead |
| Chuyển đổi | Cohort lead tạo trong kỳ, có ít nhất một đăng ký CONFIRMED trong cửa sổ 30 ngày đề xuất; công bố số chưa đủ thời gian quan sát |
| Tiền thu gộp | Tổng giao dịch vào hợp lệ theo thời điểm nhận; giao dịch chưa gán hiển thị riêng, không tự phân bổ chi nhánh |
| Tiền hoàn / thu ròng | Giao dịch hoàn thực hiện trong kỳ; thu ròng = thu gộp − hoàn trong kỳ, không gọi là lợi nhuận |
| Khoản phải thu | Tổng amountDue còn hiệu lực trừ tiền được phân bổ hợp lệ; tách quá hạn, tiền lệch và dư |
| Lấp đầy lớp | Chỗ committed / sức chứa hiện tại; hiển thị riêng hold còn hạn; lớp hủy không gộp vào tỷ lệ vận hành |
| Phản hồi đầu tiên | Tin khách đầu tiên đến câu trả lời có nội dung đầu tiên; tách AI/người, giờ trực/ngoài giờ, không tính auto-ack |
| AI tự xử lý | Hội thoại đã đóng ở chế độ AI, không có nhân viên can thiệp trong cửa sổ theo dõi đề xuất 24h; tách khỏi tỷ lệ đăng ký |
| Chuyển người | Hội thoại có ít nhất một handoff / hội thoại AI đã xử lý; không đếm mỗi event handoff là một hội thoại mới |

Chốt ngày theo Asia/Ho_Chi_Minh, version công thức và quy tắc hoàn sau kỳ cũ. Theo dõi chi nhánh học, nguồn tuyển sinh và đơn vị nhận tiền riêng; không nhân đôi doanh thu khi chuyển chi nhánh. Doanh thu phân bổ theo buổi học chỉ thêm nếu customer yêu cầu và thống nhất cơ sở ghi nhận.

Replay cần kho lưu event bền vững có retention và schema version, không coi queue RabbitMQ là lịch sử đầy đủ. RP-2 phải lưu event phục vụ replay hoặc cung cấp snapshot/export + event từ checkpoint; thử dựng lại read model và đối chiếu trước nghiệm thu. Bổ sung conversation.closed, class.updated/capacity_changed, payment.received/allocated, refund.completed và sự kiện thay đổi enrollment để đủ nguồn tính chỉ số.

## 9. Độ tin cậy và sơ đồ luồng chuẩn

Outbox cùng transaction với thay đổi DB; relay có publisher confirm; inbox/dedup cùng transaction với hiệu ứng consumer. Broker giao ít nhất một lần, không giả định exactly-once. Event có id, type, schemaVersion, entityId/entityVersion, occurredAt, correlationId, causationId và payload tối thiểu. Hỗ trợ retry/backoff có giới hạn, DLQ, cảnh báo và replay có quyền. Giữ thứ tự theo entity bằng chiến lược consumer rõ ràng; consumer phát hiện version thiếu/cũ và phục hồi thay vì chỉ dựa vào routing key.

API tạo giữ chỗ, đơn, QR, hoàn, chuyển lớp hỗ trợ idempotency và truy trạng thái theo operationId. Service không gọi API ngoài bên trong DB transaction kéo dài. Saga lưu từng bước, bù trừ và recovery worker; chạy lại sau restart phải hội tụ, không thêm đơn/tiền/chỗ.

### 9.1 Sơ đồ A – Tiếp nhận và trả lời

Khách → Channel [xác thực + lưu + dedup] → event channel.message_received → Conversation [CRM + branch + owner].

Conversation → người nhận ở M1, hoặc AI khi mode/version cho phép ở M2 → Conversation [kiểm lại quyền gửi] → event conversation.message_out → Channel [kiểm consent/cửa sổ] → kênh gốc → delivery status.

Nhánh handoff: yêu cầu tiếp quản → cập nhật mode/owner/version nguyên tử → loại phản hồi AI cũ → hàng đợi/nhân viên → Notification/escalation. Không gọi AI khi mode người.

### 9.2 Sơ đồ B – Đăng ký đến xác nhận

Khách xác nhận → Enrollment PENDING_HOLD [snapshot giá/chính sách] → Class hold nguyên tử → Enrollment HELD → Payment tạo QR → khách thanh toán → Payment [webhook hợp lệ + giao dịch + đối soát] → event payment.matched → Enrollment CONFIRMING → Class commit nguyên tử → Enrollment CONFIRMED → event enrollment.confirmed → Notification + CRM + Reporting.

Nhánh hết chỗ: Class từ chối → không QR → waitlist nếu bật hoặc tư vấn lớp khác. Nhánh hết hạn: Class expire → Enrollment EXPIRED → nhả chỗ/hủy QR. Nhánh tiền muộn: giao dịch hợp lệ → lấy lại chỗ nguyên tử nếu còn → xác nhận; không có chỗ → hoàn/chuyển có đồng ý. Nhánh tiền không xác định đơn: UNALLOCATED → kế toán, không tự gán.

### 9.3 Sơ đồ C – Đổi lịch/hủy/hoàn

Giảng viên đề nghị hoặc quản lý tạo thay đổi → quản lý duyệt → Class kiểm xung đột/version → schedule.changed hoặc class.cancelled → Enrollment tạo phương án theo từng đơn → Notification thông báo + thu lựa chọn nếu cần → hoàn/chuyển có phê duyệt → Payment ghi kết quả thực hiện → Enrollment cập nhật → Reporting đối chiếu.

Các sơ đồ này thay thế sơ đồ v1; mũi tên có nhãn event là bất đồng bộ, các bước khác là lời gọi/thao tác có kết quả. Không có mũi tên trực tiếp từ Payment đến xác nhận đăng ký với khách.

## 10. Roadmap, ticket và phân công

### 10.1 Snapshot nền và cập nhật đợt 1 ngày 27/10/2026

Snapshot trước đợt 1, dựa trên code local và biên bản nghiệm thu 26/10: monorepo, template, config/logger/broker demo đã có; Portal gọi Catalog/PostgreSQL tạo/xem/sửa khóa; API gói, migration/seed có kiểm chứng. Nghiệm thu ghi 32/32 task check và 26/26 test Catalog DB; đây là bằng chứng lịch sử, không phải kết quả chạy lại khi sửa plan.

Sau triển khai đợt 1: đã có IAM/JWT/phiên thật, Org, Gateway, quyền backend và Portal đăng nhập thật; xem hồ sơ docs/ban-giao-dot-1.md và docs/huong-dan-dot-1.md. Chưa có nghiệp vụ chat/tiền/chỗ thật. PL-1 thiếu deploy độc lập; PL-2 thiếu outbox/idempotency; PL-3 thiếu metric/trace. Không đóng WEB-4/CAT-1 hoặc toàn bộ M0/M1 dựa vào đợt 1. Customer chưa xác nhận C01–C12; GitHub Actions/PR remote chưa được xác minh trong phiên local.

### 10.2 Thứ tự và trách nhiệm

Lead: chốt contract/ADRs và C01–C12 cùng customer; IAM-1 → IAM-2; GW-1; bảo vệ Catalog; hoàn thiện PL-2/PL-3 trước luồng event; review tích hợp/CI. Dev FE: WEB-1 login thật, sau đó WEB-2/WEB-4/WEB-8 theo API. Dev BE: ORG-1 trước, ORG-2 sau IAM contract; hoàn thiện CAT-1/2, rồi CRM theo contract. Lead phụ trách logic khó CV-3, CS-4, Enrollment saga, Payment đối soát và AI tool safety.

Những việc độc lập có thể làm song song sau khi chốt contract; không chờ ORG-2 để bắt đầu GW-1 vì GW-1 phụ thuộc IAM-1. ORG-1 song song IAM-1, không ghi quyền IAM trực tiếp từ DB Org. Ticket không có owner/tiêu chí hoặc dependency chưa sẵn sàng chỉ ở trạng thái planned.

Chưa cam kết ngày hoàn thành khi chưa có năng lực thực tế và scope đã duyệt. Mỗi vòng đề xuất một tuần: chọn ít ticket, demo kết quả có bằng chứng, cập nhật estimate/phụ thuộc/rủi ro. Lead không nhận đồng thời tất cả service lõi. Một ticket thuộc một service; tích hợp xuyên service dùng parent ticket và các sub-ticket có owner riêng.

### 10.3 Danh mục ticket gốc, giữ mã và làm rõ phạm vi

M0: nền tảng. M1: người vận hành. M2: AI + một kênh ngoài. M3: mở rộng. M4: học viên. Mã giữ nguyên không có nghĩa phạm vi và thứ tự v1 vẫn áp dụng.

| Mã | Nội dung / điều kiện phụ thuộc chính | Mốc |
| --- | --- | --- |
| PL-1 | Template, CI và deploy độc lập; kiểm pipeline thật, migration và rollback | M0 |
| PL-2 | Broker + transactional outbox/inbox, idempotency, retry/DLQ, recovery; PL-1 | M0 |
| PL-3 | Log/metric/trace, cảnh báo tối thiểu, không log bí mật; PL-1 | M0 |
| IAM-1 | Login nhân viên, token role/branch, mật khẩu hash; PL-1 | M0 |
| IAM-2 | Ma trận quyền, middleware service, kiểm scope; IAM-1 | M0 |
| IAM-3 | OTP học viên, chống brute force và ownership; IAM-1/2 | M4 |
| ORG-1 | Sáu đơn vị/phòng ban và trạng thái; PL-1, bảo vệ bằng IAM-2 trước pilot | M0 |
| ORG-2 | Nhân sự/giảng viên, gán phạm vi qua IAM có trạng thái đồng bộ; ORG-1, IAM-1/2 | M0 |
| GW-1 | Route + xác thực token, truyền correlation; IAM-1 | M0 |
| GW-2 | Rate limit và BFF cần cho pilot; GW-1 | M1 |
| CH-1 | Khung adapter, xác thực, dedup, ghi bền; PL-2 | M1 |
| CH-2 | Web chat session/reconnect và gửi hai chiều; CH-1 | M1 |
| CH-3 | Zalo OA, delivery/cửa sổ; CH-1 + quyền đã cấp | M2 hoặc sau |
| CH-4 | Facebook Messenger, delivery/cửa sổ; CH-1 + quyền đã cấp | M2 hoặc sau |
| CH-5 | Instagram; CH-1 + quyền đã cấp | M3 |
| CH-6 | TikTok; chỉ lập lịch sau xác minh khả năng/quyền API | M3 |
| CH-7 | Mapping chi nhánh, cửa sổ trả lời, token hết hạn; CH-1, ORG-1 | M1 |
| CV-1 | Lưu tin/hội thoại và gắn chi nhánh; CH-1, CRM-1, PL-2 | M1 |
| CV-2 | Gửi tin qua event, trạng thái delivery; CV-1, CH-1 | M1 |
| CV-3 | Owner, hàng đợi, handoff nguyên tử, version chống AI cũ; CV-1 | M1; AI ở M2 |
| CV-4 | Retention/xóa và theo dõi hoàn tất; CV-1, CRM-4 | M3; cơ chế xóa thủ công có kiểm soát trước pilot |
| CRM-1 | Contact/learner/payer, định danh kênh và tìm/tạo; PL-1, IAM-2 | M1 |
| CRM-2 | Gộp hồ sơ có xác minh và xử lý xung đột; CRM-1 | M3 |
| CRM-3 | Lead/stage/source/owner, chặn trùng theo quy tắc; CRM-1 | M1 |
| CRM-4 | Consent, thu hồi và yêu cầu xóa có xác minh/tracking; CRM-1 | M1 |
| CAT-1 | Khóa/gói/giá chung + policy version, quyền sửa; PL-1, IAM-2 | M1 |
| CAT-2 | Lọc mục tiêu/trình độ/hình thức/chi nhánh/ngân sách, chỉ dữ liệu hợp lệ; CAT-1 | M1 |
| CAT-3 | FAQ/chính sách RAG đã duyệt có version; CAT-1 | M3 |
| CS-1 | Lớp/buổi/phòng, vòng đời và điều kiện mở bán; PL-1, ORG-2, CAT-1 | M1 |
| CS-2 | Giờ rảnh/nghỉ, xung đột và duyệt thay đổi; CS-1 | M1 |
| CS-3 | Tìm lớp theo giờ/còn chỗ/được mở bán; CS-2 | M1 |
| CS-4 | Hold/expire/commit nguyên tử, limit và idempotency; CS-1, PL-2 | M1 |
| CS-5 | Đổi/hủy lớp, khóa bán và event có version; CS-1, PL-2 | Hủy lớp M1; mở rộng M3 |
| CS-6 | Online/onsite, ràng buộc phòng/link; CS-1 | M1 |
| ENR-1 | State machine mục 6.3 và snapshot; PL-2, CAT-1, IAM-2 | M1 |
| ENR-2 | Saga giữ/QR/commit, reconciliation và bù trừ; ENR-1, CS-4, PAY-1/2 | M1 |
| ENR-3 | Hết hạn, hủy chưa thu và race với tiền; ENR-2 | M1 |
| ENR-4 | Waitlist/lời mời có hạn; ENR-3 | M3 |
| ENR-5 | Hủy lớp và phương án đơn có/không có tiền; ENR-1, CS-5, PAY-4 tối thiểu | M1 tối thiểu |
| PAY-1 | Adapter QR, idempotency, hạn và tra trạng thái; PL-1 | M1 |
| PAY-2 | Webhook hợp lệ, ledger/dedup, matched/review event; PAY-1, PL-2 | M1 |
| PAY-3 | UNALLOCATED/thiếu/thừa/trùng/tiền muộn, owner và hạn REVIEW; PAY-2 | M1 |
| PAY-4 | Yêu cầu/duyệt/ghi thực hiện hoàn, giới hạn tiền và audit; PAY-3, IAM-2 | Tối thiểu M1, đầy đủ M3 |
| PAY-5 | Đối soát hằng ngày và xử lý chênh lệch; PAY-2 | Thao tác kiểm soát M1, tự động M3 |
| PAY-6 | Hóa đơn mô phỏng, yêu cầu và file an toàn; PAY-2, NT-1 | M3 |
| AG-1 | Khung agent theo mode/version, draft trước; CV-2/3 | M2 |
| AG-2 | Tools Catalog/Class, nguồn và thời điểm đọc; AG-1, CAT-2, CS-3 | M2 |
| AG-3 | Hồ sơ nhu cầu, tối đa hai câu hỏi/lượt; AG-1 | M2 |
| AG-4 | Tool Enrollment sau xác nhận khách; AG-2, ENR-2 | M2 sau UAT |
| AG-5 | Guardrail dữ liệu/quyền/prompt injection; AG-2 | M2 trước auto-send |
| AG-6 | Handoff và lỗi tool/timeout; AG-1, CV-3 | M2 |
| AG-7 | Che PII, tool context theo khách; AG-1, CRM-1/4 | M2 trước LLM thật |
| AG-8 | Log nguồn/version và bộ eval hồi quy; AG-1 | M2, không đợi M3 |
| AG-9 | Giới hạn chi phí/tool/conversation/day; AG-1 | M2, không đợi M3 |
| AG-10 | Thu yêu cầu hóa đơn qua backend/form an toàn; AG-4, PAY-6 | M3 |
| NT-1 | Ý định/delivery/retry và xác nhận sau enrollment.confirmed; PL-2 | M1 |
| NT-2 | Báo người nhận/escalation; NT-1, CV-3 | M1 |
| NT-3 | Nhắc học theo version lịch và consent; NT-1 | M3 |
| NT-4 | Đổi lịch/hủy và theo dõi gửi thất bại; NT-1, CS-5 | Tối thiểu M1 |
| RP-1 | Audit đọc/ghi nhạy cảm, kiểm quyền và không sửa; PL-2, IAM-2 | M1 |
| RP-2 | Event store/checkpoint hoặc snapshot+delta, read model/rebuild; PL-2 | M1 tối thiểu |
| RP-3 | Báo cáo lead/đăng ký/tiền đúng định nghĩa; RP-2 | M3 |
| RP-4 | Lấp đầy/response/AI metrics đủ nguồn; RP-2, AG-8 | M3 |
| WEB-1 | Portal login/session thật, menu từ quyền, 401/403; GW-1, IAM-1/2 | M0 |
| WEB-2 | Hộp thư, owner/hàng đợi, reply/handoff/delivery; WEB-1, CV-2/3 | M1 |
| WEB-3 | Lead/đăng ký tại quầy, snapshot và trạng thái riêng tiền/chỗ; WEB-1, CRM-3, ENR-1 | M1 |
| WEB-4 | Khóa/gói/lớp/lịch và quyền quản lý; WEB-1, CAT-1, CS-1 | M1 |
| WEB-5 | Hàng đợi kế toán/hoàn, dữ liệu tối thiểu; WEB-1, PAY-3/4 | M1 tối thiểu |
| WEB-6 | Giảng viên khai giờ rảnh/xem lịch, đề nghị nghỉ; WEB-1, CS-2 | M1 |
| WEB-7 | Dashboard có định nghĩa, khoảng kỳ và lag; RP-3/4 | M3 |
| WEB-8 | Widget chat, session/reconnect và lỗi mạng; CH-2 | M1 |
| WEB-9 | Student Portal theo ownership; IAM-3, Enrollment/Class/Payment API | M4 |

### 10.4 Ticket bổ sung để khép khoảng trống

| Mã | Owner/service | Phạm vi và nghiệm thu chính | Phụ thuộc / mốc |
| --- | --- | --- | --- |
| PM-1 | PM/customer | Khảo sát, baseline và C01–C12 có người duyệt; scope/UAT được ký nhận | Trước pilot |
| IAM-4 | IAM | Refresh/logout, khóa/thu hồi phiên, test quyền cũ bị vô hiệu trong hạn đã chốt | IAM-1/2 / M0 |
| CV-5 | Conversation | Phân công/chuyển chi nhánh, ngoài giờ, hạn nhận và escalation kiểm chứng được | CV-1/3, ORG-1 / M1 |
| CAT-4 | Catalog | Policy version/effectiveAt, ngừng bán và lịch sử; đơn cũ giữ snapshot | CAT-1 / M1 |
| CS-7 | Class & Schedule | Sĩ số tối thiểu, deadline khai giảng, thay người/học bù và xử lý xung đột | CS-1/2/5 / tối thiểu M1, mở rộng M3 |
| ENR-6 | Enrollment | Bảo lưu có hạn/quyền lợi/lần dùng, không hứa chỗ tương lai | ENR-1, policy đã duyệt / M3 hoặc trước bán chính sách |
| ENR-7 | Enrollment | Saga chuyển lớp/chênh lệch/bù trừ, không mất chỗ cũ khi lỗi | ENR-2, CS-4, PAY-3/4 / M3 |
| PAY-7 | Payment | Thu thủ công/chứng từ/phê duyệt, không mạo danh webhook | C04, PAY-2, IAM-2 / có điều kiện |
| CRM-5 | CRM | Import khách/lead, báo lỗi và rollback batch không làm trùng | CRM-1, C12 / trước pilot nếu có dữ liệu cũ |
| CS-8 | Class & Schedule | Import lớp/buổi/room và kiểm xung đột, đối chiếu số lượng | CS-1/2, C12 / có điều kiện |
| ENR-8 | Enrollment | Import đơn/quyền lợi cũ qua API chủ dữ liệu, đối chiếu chỗ | ENR-1, CS-8 / có điều kiện |
| PAY-8 | Payment | Nhập số dư/giao dịch lịch sử có nguồn, đối chiếu kế toán; không giả phát giao dịch mới | PAY-2, C12 / có điều kiện |
| OPS-1 | Platform | Backup/restore thử, secret/config, health/readiness và runbook sự cố | PL-1/3 / trước pilot |
| UAT-1 | Lead + customer | Bộ nghiệm thu mục 11, bằng chứng lỗi/chạy lại và quyết định go/no-go | Parent xuyên service; mỗi lỗi có ticket owner riêng |

Mã PM/OPS/UAT là quản lý/phát hành, không phải service mới. Import xuyên service dùng một parent migration plan, từng service tự nhập dữ liệu của mình theo ID mapping và thứ tự; không có script ghi thẳng DB nhiều service.

## 11. Tiêu chí chất lượng, UAT và phát hành

### 11.1 Ngưỡng đề xuất để customer xác nhận

Trước pilot đo trên tải dự kiến: đề xuất 20 người dùng nội bộ đồng thời và 50 phiên web chat, API đọc p95 ≤ 2 giây không gồm provider/LLM; tin vào hộp thư p95 ≤ 5 giây; LLM quá 20 giây chuyển trạng thái chờ/handoff. Đề xuất giờ trực 08:00–20:00, nhận hội thoại trong 5 phút; ngoài giờ thông báo rõ. Đây là ngưỡng thử nghiệm, không phải SLA đã cam kết hoặc tải đã được chứng minh.

Đề xuất RPO 24 giờ/RTO 4 giờ cho pilot đồ án, backup DB hằng ngày và diễn tập restore. Nếu customer cần mức tốt hơn, phải thay thiết kế/chi phí trước go-live. Reconciliation với cổng thanh toán là bắt buộc để khôi phục giao dịch sau restore; kiểm lại chỗ/đơn bị ảnh hưởng, không mở bán ngay sau restore chưa đối chiếu.

Ngân sách LLM/ngày/hội thoại và hạ tầng được customer chốt tại C11; vượt hạn không làm mất tin, chuyển người. Theo dõi tỷ lệ webhook lỗi, outbox backlog, DLQ, saga quá hạn, giao dịch chưa gán, hold hết hạn, delivery lỗi và quyền bị từ chối; cảnh báo có owner và hướng xử lý.

### 11.2 Bộ UAT tối thiểu

| Mã | Kịch bản | Kết quả bắt buộc |
| --- | --- | --- |
| U01 | Login đúng/sai, token hết hạn, logout/khóa account | Đúng phiên được vào; phiên vô hiệu bị chặn theo giới hạn đã chốt |
| U02 | Truy cập chéo branch, gọi service trực tiếp, sai learnerId | 403 hoặc phản hồi không lộ dữ liệu theo hợp đồng; có audit cần thiết |
| U03 | Retry tin/webhook, reconnect widget | Không thêm bản ghi/hiệu ứng trùng, lịch sử đúng quyền |
| U04 | Hai nhân viên nhận cùng hội thoại | Một owner; người thua thấy trạng thái mới |
| U05 | AI đang soạn thì nhân viên nhận, khách gửi tin mới | Không gửi phản hồi AI cũ; thứ tự xử lý đúng |
| U06 | Lớp PLANNED/đã hủy/đầy/qua hạn | Không bán; không QR; đưa lựa chọn phù hợp |
| U07 | Hai khách mua chỗ cuối; expire/commit đồng thời | Tối đa một chỗ committed; không âm chỗ hoặc vượt sức chứa |
| U08 | Retry giữ chỗ/tạo QR, timeout rồi restart | Cùng kết quả hoặc trạng thái tra cứu được; không đơn/QR độc lập ngoài ý muốn |
| U09 | Đủ tiền đúng mã | Ghi tiền một lần; chỉ báo đăng ký thành công sau Class commit |
| U10 | Thiếu/thừa/sai mã, hai chuyển khoản thật, webhook lặp | Phân loại đúng; giao dịch chưa gán có owner; không cộng tiền trùng |
| U11 | Tiền về muộn còn/hết chỗ, REVIEW hết hạn | Lấy lại chỗ nguyên tử hoặc hoàn/chuyển có đồng ý; không bán trùng |
| U12 | Broker/provider/DB tạm lỗi, event giao lại, DLQ | Không mất dữ liệu đã acknowledge; phục hồi hội tụ, có cảnh báo |
| U13 | Thay giá/chính sách sau đặt, sửa lịch/hủy lớp | Snapshot cũ giữ nguyên; xử lý và thông báo theo đúng version |
| U14 | Hoàn một phần/toàn bộ, retry, người tự duyệt | Không hoàn quá tiền; không tự duyệt; chỉ REFUNDED khi đủ kết quả thực hiện |
| U15 | Chuyển lớp/bảo lưu khi tính năng được bật | Không mất quyền lợi/chỗ cũ ngoài chính sách; chênh lệch và hạn được ghi rõ |
| U16 | Khách không consent/thu hồi/yêu cầu xóa | Tư vấn chung vẫn được; thao tác nhạy cảm đúng quyền; theo dõi xóa đủ service |
| U17 | Khách là người trả thay/hồ sơ trùng | Không tự gộp sai; đăng ký/hóa đơn đúng người; không lộ hồ sơ |
| U18 | Báo cáo, replay, hoàn sau kỳ cũ, chuyển branch | Khớp nguồn theo định nghĩa; không nhân đôi tiền; có checkpoint/lag |
| U19 | Backup/restore và import nếu có | Khôi phục thử thành công; tổng tiền/chỗ và mẫu dữ liệu được đối chiếu |
| U20 | Mobile 390px, keyboard, form lỗi, provider chậm | Luồng chính dùng được; không báo thành công giả, có hướng xử lý |

M2 bổ sung bộ ít nhất 50 hội thoại đã gán nhãn bởi tuyển sinh: thiếu thông tin, online, không có lớp, prompt injection, xin ngoại lệ, đổi người và tool lỗi. Đề xuất yêu cầu 100% trường hợp chứa giá/lịch/chỗ truy được đến nguồn, 100% tình huống vượt quyền bị chặn và handoff bắt buộc được thực hiện; ít nhất 90% đề xuất phù hợp nhãn tuyển sinh. Sai tiền/chỗ/quyền hoặc lộ dữ liệu là lỗi chặn auto-send dù điểm trung bình đạt. Chạy lại khi đổi prompt/model/tool/policy; customer duyệt ngưỡng trước bật AI.

### 11.3 Definition of Done và go/no-go

Mỗi ticket có 2–4 tiêu chí cụ thể, contract/API/event version, migration/seed nếu cần, kiểm quyền và lỗi, test đúng rủi ro, hướng dẫn vận hành và bằng chứng review. Test DB/broker có cấu hình thật không được thay bằng kết quả skip. CI remote và trạng thái deploy được ghi riêng với check local.

Go-live M1 cần: C01–C12 liên quan scope đã chốt; UAT luồng chính và ngoại lệ tiền/chỗ đạt; không còn lỗi nghiêm trọng về mất tiền/chỗ/dữ liệu/quyền; có backup/restore, đối chiếu dữ liệu, tài khoản vận hành, owner hỗ trợ và phương án quay lại xử lý thủ công. Mục bị hoãn phải có customer chấp nhận và cách xử lý; không cho phép hoãn lỗi an toàn tiền/quyền bằng ghi chú.

Release có migration tương thích, backup trước thay đổi, health/readiness, smoke test, người quyết định rollback và hướng xử lý event đang chạy. Khi rollback ứng dụng không tự đảo migration phá dữ liệu. Có công tắc tắt AI, dừng tạo QR/hold mới hoặc chuyển chế độ chỉ đọc mà vẫn tiếp nhận/xử lý giao dịch đã đến. Pilot thật dùng credential thật có kiểm soát; đồ án dùng sandbox và gắn nhãn mô phỏng.

## 12. Rủi ro, thay đổi và việc cần làm ngay

| Rủi ro | Cách xử lý / owner |
| --- | --- |
| 13 service quá tải đội ba người | Lead giới hạn số ticket đang làm, dựng service theo nhu cầu mốc, giữ contract và Docker Compose; xem lại estimate mỗi vòng |
| Customer đổi chính sách sau khi bán | PM quản version, ngày hiệu lực và phê duyệt; đơn giữ snapshot, có quy trình ngoại lệ |
| Không được cấp quyền kênh | Chủ tài khoản customer kiểm sớm; web chat làm đường chính; không cam kết kênh chưa duyệt |
| AI nói sai hoặc vượt ngân sách | Lead bật từ draft, eval/guardrail, quota và kill switch; nhân viên có đường tiếp quản |
| Sai tiền/chỗ khi lỗi phân tán | Lead chịu trách nhiệm race test, reconciliation và phục hồi saga; không phát hành nếu chưa qua UAT |
| Nhập dữ liệu sai/khách không dùng được | Người vận hành duyệt mapping, chạy thử import và đào tạo theo vai trò; kế toán ký đối chiếu |
| Thiếu bằng chứng nghiệm thu/CI | Mỗi mốc lưu commit, môi trường, lệnh/kết quả và người duyệt; không đánh dấu hoàn tất từ README hoặc demo mock |

Thay đổi phạm vi phải ghi vấn đề customer, mục tiêu liên quan, ticket/service, phụ thuộc, tác động thời gian/chi phí và UAT; PM/customer quyết định đổi mốc hoặc thay một mục tương đương. Không tự thêm tính năng vì có sẵn thư viện hoặc vì AI có thể làm.

Việc tiếp theo: PM/Lead xác nhận scope và chính sách C01–C12; Lead bắt đầu IAM-1/IAM-2/IAM-4 và chốt contract; dev BE làm ORG-1, dev FE chuẩn bị WEB-1 theo contract. Nghiệm thu mốc gần nhất: đăng nhập thật → menu từ quyền → Catalog chặn thao tác trái quyền cả qua Gateway và khi gọi trực tiếp. Sau đó hoàn thiện PL-2 và luồng M1 trước khi bật AI tự động.

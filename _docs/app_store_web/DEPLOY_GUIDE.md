# 홈서버 정적 페이지 전달

기준일: 2026-10-18. 로컬 전달 준비만 완료했으며 서버 배포는 수행하지 않았습니다.

## 파일 역할·의존성·사용 예

| 파일 | 역할 | 의존성·사용 예 |
| --- | --- | --- |
| `support.html` | 제공받은 고객지원 HTML 원본 | 외부 자산 없음. 확정본 배포 시 `/support` 본문 |
| `drafts/privacy.html` | 비공개 main에만 보관하는 개인정보처리방침 초안 원본 | 운영 정책 확정 필요. 공개 디렉터리에 복사 금지 |
| `locations.conf.example` | 두 경로 및 끝 슬래시 redirect 예시 | Nginx의 기존 www 도메인 HTTPS server 블록에 병합 |
| `DEPLOY_GUIDE.md` | 준비·검증·롤백 절차 | 운영 담당자가 실제 경로·권한·TLS를 확인하여 사용 |

## 적용 전 확인

- `sudo nginx -T`에서 `www.shiftmate.co.kr`을 받는 HTTPS server 블록과 원본 설정 경로를 확인합니다. 공유 전 secret·내부 식별 정보는 가립니다.
- DNS의 www 도메인이 현재 홈서버로 연결되는지, TLS 인증서가 `www.shiftmate.co.kr`을 포함하는지 확인합니다. wildcard 인증서만으로 루트 도메인을 보장하지 않습니다.
- 기존 HTML 및 수정할 Nginx 설정을 공개 디렉터리 밖에 백업합니다. 기존 API proxy와 upstream은 유지합니다.
- 개인정보처리자·담당자·시행일·보유 및 파기·백업·위탁/이전 등 미확정 정책을 실제 운영 근거로 작성합니다. 초안 문구를 단순 제거해서는 안 됩니다.
- 지원 페이지가 `/privacy`로 연결되므로 두 페이지가 정상 제공되는 상태를 최종 배포 기준으로 합니다.

## 정책 확정 후 배치

확정한 개인정보처리방침을 별도 준비 디렉터리에 `privacy.html`로 둡니다. 아래는 그 디렉터리에 두 확정본을 전달한 뒤 홈서버에서 실행할 예시입니다. `drafts/privacy.html`은 사용하지 않습니다.

```bash
sudo install -d -m 755 /var/www/shiftmate
sudo install -m 644 support.html /var/www/shiftmate/support.html
sudo install -m 644 privacy.html /var/www/shiftmate/privacy.html
```

Nginx가 파일을 읽고 상위 디렉터리를 탐색할 수 있어야 합니다. 컨테이너 환경이면 해당 경로를 read-only mount합니다. 공개 경로에는 HTML 확정본 두 개만 배치합니다.

`locations.conf.example`의 location들을 기존 `www.shiftmate.co.kr` HTTPS server 블록에 병합합니다. 동일 경로가 있으면 중복 생성하지 않습니다. server 블록·인증서·기존 proxy 설정 전체를 덮어쓰지 않습니다. 전역 인증·응답 헤더·캐시·error_page 상속도 확인합니다.

```bash
sudo nginx -t
```

검사가 성공한 경우에만 아래를 실행합니다. Docker/NAS는 현재 관리 방식에 맞춰 검사 및 reload합니다.

```bash
sudo systemctl reload nginx
```

## 확인

홈서버 밖에서도 검사하며 인증서 오류를 숨기는 `-k`는 사용하지 않습니다.

```bash
curl --fail --show-error -I https://www.shiftmate.co.kr/support
curl --fail --show-error -I https://www.shiftmate.co.kr/privacy
curl -I https://www.shiftmate.co.kr/support/
curl -I https://www.shiftmate.co.kr/privacy/
curl --fail --show-error https://www.shiftmate.co.kr/privacy -o /tmp/shiftmate_privacy_check.html
rg -n '운영 확인 필요|공개 전 초안|검토 초안|class="pending"' /tmp/shiftmate_privacy_check.html
curl --fail --show-error https://api.shiftmate.co.kr/api/v1/health
curl --fail --show-error https://stage-api.shiftmate.co.kr/api/v1/health
```

두 기본 경로는 인증 없이 200과 `Content-Type: text/html; charset=utf-8`, 끝 슬래시는 기본 경로로 301이어야 합니다. 초안 검색 결과가 없고 GET 본문·이메일·상호 링크가 정상인지 확인합니다. iPhone Safari에서 가로 넘침도 확인합니다. 실제 API health URL이 다르면 현재 운영 정본을 따릅니다.

배포 시각·상태·Content-Type·정책 시행일·정책 검토 완료·API 회귀 결과를 기록한 뒤 App Store URL로 사용합니다. 앱 내 링크 연결은 별도 작업입니다.

## 롤백

추가·변경한 도메인 설정과 HTML만 백업으로 복구하고 `nginx -t` 성공 후 reload합니다. 기존 API health를 재확인합니다. 이미 공개한 정책은 직전 확정본으로 복구하고 URL을 유지합니다.

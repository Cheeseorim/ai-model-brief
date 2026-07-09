# AI Model Brief

OpenAI, Anthropic Claude, Google Gemini, Vertex AI, Amazon Bedrock의 공식 문서를 매일 확인해 모델 출시, API 변경, 가격 변화, 지원 종료 신호를 정리하는 대시보드입니다.

## 제공 기능

- 16개 공식 문서·뉴스 출처 수집
- 페이지 전체 해시가 아닌 항목 단위 변경 감지
- 모델 ID 추출 및 플랫폼별 분리
- 지원 종료·호환성 변경·출시·가격 분류
- `OPENAI_API_KEY` 설정 시 중요 신규 항목만 한국어 AI 브리핑 생성
- 수집기 실패 및 빈 파싱 감지
- Discord 고위험 변경 알림
- GitHub Pages 정적 대시보드
- GitHub Actions 매일 09:00 KST 실행
- 90일 수집 실행 이력

## 로컬 실행

```bash
npm install
npm test
npm run collect
npm run build
npm run dev
```

`http://localhost:3000`에서 대시보드를 확인할 수 있습니다.

## 설정

`config/sources.json`에서 공식 출처를, `config/watchlist.json`에서 사용하는 플랫폼과 모델을 관리합니다.

로컬에서 키를 붙여 테스트하려면 `.env.example`을 `.env`로 복사한 뒤 값을 채웁니다. 자연스러운 한국어 번역·요약을 사용하려면 저장소의 Actions secret에 `OPENAI_API_KEY`를 추가합니다. 기본 모델은 `gpt-5.4-mini`이며, 하루 최대 요약 항목 수는 `SUMMARY_MAX_EVENTS`로 제한합니다.

Discord 알림을 사용하려면 저장소의 Actions secret에 `DISCORD_WEBHOOK_URL`을 추가합니다. 환경변수 전체 목록은 `.env.example`을 참고하세요.

## 데이터

- `data/events.json`: 정규화된 변경사항
- `data/state.json`: 출처별 마지막 수집 상태
- `data/runs.json`: 최근 90회 실행 결과

수집 결과는 Git에 커밋되어 공식 페이지가 나중에 수정되더라도 최초 감지 이력을 남깁니다.

## 주의

공식 문서의 DOM 구조가 바뀌면 해당 출처는 실패 상태가 됩니다. 실패를 “변경 없음”으로 취급하지 않도록 빈 결과도 오류로 처리합니다.

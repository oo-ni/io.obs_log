---
title: "Text Watermarking"
date: 2026-10-07
tags: ["AI", "LLM"]
category: "Artificial Intelligence/LLM"
description: "Google, Anthropic, OpenAI 등이 EU 인공지능 법안에 따라 LLM 생성 텍스트에 워터마크를 적용하고 있으며, 주요 방식으로는 green/red list, Gumbel, tournament sampling, textGrain 등이 있다. 워터마크는 마지막 샘플링 단계에서만 작동하고 분포 엔트로피가 충분할 때만 유효하지만, 패러프레이징이나 편집으로 쉽게 제거되므로 결국 출처 표시 도구일 뿐 진정한 AI 탐지 수단으로는 한계가 있다."
showSummary: true
aiSummary: true
---

2024년 Google의 워터마크 적용을 시작으로, 올해 8월엔 Anthropic, 10월엔 OpenAI가 LLM이 생성하는 글에 텍스트 워터마크를 적용하겠다는 입장을 밝혔습니다. OpenAI의 [Our approach to EU text provenanace rules](https://openai.com/index/eu-text-provenance/)과 여러 AI 연구 블로그에서 말하는 바에 따르면 [EU의 인공지능 법안](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng#art_50)에 따라 특정 인공지능 생성 및 조작 콘텐츠에 대한 투명성 의무가 요구되는 것 같습니다.

솔직히 AI가 만들어낸 결과물을 인간이 정확히 판별할 수 있는 시기는 진작에 지났다고 생각합니다. 그래서 저런 윤리적 목소리가 나오는 것이라 생각하고, AI 활용자들도 그에 따른 불안감? 을 느끼는 것 같습니다. 워터마크 적용이 본격화 된 이후, watermark-remover, cleaner 같은 레포가 깃허브에서도 많은 star를 받고 있는 걸 보면 확실히 그런 것 같네요..

이미지야 위에 뭐 덧씌우면 되겠지 하고 넘겼는데, 텍스트는 어떻게 워터마킹 하는건지 궁금해서 공부해봤습니다.

# 텍스트 워터마크
간단히 말해, 텍스트 워터마크는 글에 뭔가를 숨겨 넣는게 아닙니다. LLM이 가중치를 통해 단어를 판단하는 과정에서, 비밀키를 통한 ~~ 입니다.

# 주요 방식 및 워터마크 탐지
#### Kirchenbauer – green/red list (2023, ICML)
비밀키로 해시하여 green_list에 넣은 단어에 가중치를 주는 방식입니다.

매 스텝마다 직전 토큰을 비밀 키와 함께 해시해서 그 값을 시드로 어휘를 무작위로 둘로 나눕니다. 비율 $\gamma$(예: 0.25~0.5) 만큼은 green, 나머지는 red list에 넣습니다. 그리고 green 토큰의 logit에 $\delta$만큼의 확률을 살짝 얹어줍니다.

탐지할 땐 같은 키로 각 위치의 green list를 다시 계산하고, 텍스트 길이가 T일 때 green 토큰 수 $|s|_G$를 세서 $z = \frac{\left| s \right|_G - \gamma T}{\sqrt{T \gamma (1 - \gamma)}}$ 를 구합니다. 사람이 쓴 글은 우연히 $\gamma$ 비율 근처에 머물고, 워터마크된 글은 green이 비정상적으로 많아서 $z$가 4~5를 훌쩍 넘습니다. 동전을 200번 던졌는데, 앞면만 150번 나오면 좀 수상하잖아요? 탐지는 그런 방식으로 진행됩니다. 단점은 logit을 직접 밀기 때문에 분포가 실제로 왜곡된다는 것이고, $\delta$를 크게 할수록 결과 품질이 떨어집니다.

#### Aaronson – Gumbel (2022)
OpenAI에 있던 Scott Aaronson이 제안한 방식이고, Anthropic의 SynthID 방식도 이 계열을 기반으로 설계됐다고 합니다. 난수 조정을 통해 품질 누락 없이 워터마크를 구현하는 방식입니다.

키 + 직전 토큰으로 각 후보 토큰 $i$에 대해 균등난수 $r_i$를 만들고, $r_i^{(\frac{1}{p_i})}$가 최대인 토큰을 고릅니다. 이건 Gumbel-max trick이라 $r$이 진짜 난수라면 정확히 $p$에서 샘플링한 것과 같은 분포가 나옵니다. 즉 **분포 왜곡이 0**입니다. 대신 고른 토큰들의 $r$값이 체계적으로 1에 가깝게 쏠리므로, 탐지는 $\Sigma-ln(1-r)$ 같은 점수로 합니다.

워터마크는 진짜 난수를 키 + 직전 토큰 + 후보 토큰을 해시한 의사난수로 바꾸는 것으로 구현합니다. 키를 모르는 사람은 이게 진짜 난수인지 해싱된 의사난수인지 모르니까 분포를 그대로 따르고, 키를 아는 사람은 각 위치에서 뽑힌 토큰의 $r$값을 계산할 수 있기에 품질 손실(분포 왜곡)이 없는겁니다. green/red와 달리 "특정 단어 쪽으로 미는"게 아니라 "어떤 난수를 쓰느냐"만 고정하는게 차이점입니다.

#### Google SynthID-Text – tournament sampling (2024, Nature)
Google DeepMind 방식이고, 구현이 오픈소스로 Hugging Face에 공개되어 있습니다.

먼저 모델 분포 $p$에서 후보 토큰을 $2^m$개 뽑습니다. 그 다음 $m$개 층의 토너먼트를 엽니다. 각 층 $\ell$마다 키 + 직전 H개 토큰 + 후보 토큰으로 $g_\ell$(토큰) $\in$ {0,1} 값을 계산하고, 두 후보씩 짝지어 $g$값이 높은 쪽이 토너먼트로 다음 라운드에 올라가서(동점이면 랜덤) 최종 우승자가 출력 토큰이 됩니다.

후보 자체가 모델 분포에서 나왔으니 엉뚱한 단어가 끼어들 수 없고, 결과적으로 선택된 토큰들은 $g$값이 평균보다 높은 쪽으로 쏠립니다. 탐지는 텍스트의 모든 토큰, 모든 층에 대해 $g$값을 다시 계산해 평균을 내거나, [논문](https://www.nature.com/articles/s41586-024-08025-4)에 적힌 Bayesian Scorer로 판단합니다. 같은 n-gram 컨텍스트가 반복되면 같은 시드가 반복돼 편향이 누적되므로, 반복 컨텍스트는 워터마킹을 건너뛰는 처리도 들어가 있습니다.

#### OpenAI – textGrain (2026)
Aaronson 방식의 키와 문맥이 같으면 항상 같은 토큰을 뽑아서 다양성이 0이 되는 문제에서, 엔트로피($\beta$)로 다양성을 조절할 수 있게 고친 버전입니다.

매 스텝마다 키와 직전 문맥으로 어휘를 B개 블록으로 나누고, 각 블록 확률은 안에 든 토큰들 확률을 더한 값으로 잡습니다. 그 다음 `블록 x m`개 열 짜리 표를 만들어서 칸마다 키로 만든 Gumbel 점수를 깔아둡니다. 그리고 열마다 점수 높은 칸이 더 잘 뽑히도록 블록 확률을 재분배하는데, 아무렇게나 몰아주면 분포가 틀어지니까 모든 열을 평균내면 원래 블록 확률이 그대로 나오도록 제약을 걸어서 분포 왜곡을 막습니다. 이 조건을 만족하면서 최대한 점수 높은 쪽으로 확률을 옮기는 계산이 최적 수송(Sinkhorn) 알고리즘 입니다.

몰아주는 정도는 엔트로피 예산 $\beta$로 정하는데, $\beta$는 "원래 샘플링의 무작위성 중 몇 %를 키에 넘겨줄지"를 뜻합니다. $\beta = 0$이면 평소 샘플링과 같습니다. 실제 생성은 키가 열 하나를 고르고, 그 열의 확률로 블록을 뽑은 뒤, 블록 안에선 원래 확률 비율대로 평범하게 토큰을 뽑습니다. 키는 블록 선택에만 관여하니까 같은 프롬프트에서도 다른 답이 나올 여지가 남게됩니다.

탐지할 땐 같은 키로 블록 분할과 점수표, 선택된 열을 재구성하고, 실제 토큰이 속한 블록의 Gumbel 값을 $-log(1-F(Z))$로 바꿔 전부 더합니다. 사람이 쓴 글이면 이 합이 $Gamma(n, 1)$을 따르고 워터마크 글은 그보다 확연히 큽니다. 탐지기는 모델도 $\beta$도 몰라도 되고, 작은 모델이 초안을 쓰고 큰 모델이 검증하는 speculative decoding과도 같은 키를 공유하면 호환되게 설계되어 있습니다. 단점은 매 토큰마다 작은 최적화 문제를 풀어야 해서 앞의 방식들보다는 계산이 무겁다는 점입니다.

# LLM 샘플링과 워터마크
그럼 LLM은 출력 생성 중 어느 부분에서 워터마크를 샥 끼워넣을까요? transformer가 지금까지의 문맥으로 순전파(forward pass)를 돌리면, 어휘 전체에 대한 점수인 logit이 나옵니다. 이걸 softmax에 넣으면 확률분포 $p$가 되고, temperature나 top-p로 분포를 다듬은 뒤 **주사위를 굴려** 토큰 하나를 뽑습니다. 이 주사위를 굴리는 마지막 단계가 샘플링입니다.

앞의 4가지 방식 모두 **마지막 샘플링 단계**만 건드립니다. green/red list는 softmax 직전에 logit을 살짝 밀고, Gumbel, SynthID, textGrain은 주사위 자체를 키로 만든 주사위로 바꿔치기합니다. 모델 가중치도, 어텐션도, KV 캐시도 그대로입니다. 그래서 워터마크를 켜도 토큰이 추가되지 않고, 속도나 비용도 거의 그대로입니다.

#### 엔트로피 = 워터마크의 저장 용량
워터마크는 "아무거나 골라도 되는 순간"에만 남길 수 있습니다. "오늘 날씨는 따뜻하고..." 다음에 "맑다"와 "화창하다"는 둘 다 그럴듯하니 키가 끼어들 여지가 있지만, `2 + 2 =` 다음엔 `4`밖에 없죠? 확률이 한 토큰에 99% 몰려있으면 어떤 방식을 써도 결과가 같아서, 서명할 자리가 남지 않게 됩니다.

이 **선택의 여지**를 정보이론에서는 **엔트로피**라고 부릅니다. $H(p) = -\sum_i p_i \log p_i$ 로, 분포가 평평할수록 크고 한 곳에 몰릴수록 0에 가까워집니다. 워터마크 입장에서 엔트로피는 일종의 저장 용량인 셈입니다.

그래서 출력의 특•성에 따라, 엔트로피가 들어갈 여지가 적으면 워터마크 적용이 어렵습니다.
- **코드•수학•사실 나열**: 정답이 정해진 자리가 많아서 엔트로피가 낮고, 워터마크가 정밀하게 적용되지 않습니다. OpenAI 실험에서도 수학 콘텐츠의 탐지율이 확연히 낮았습니다.
- **짧은 글**: 서명 횟수 자체가 적습니다. 동전 10번 던져서 앞면 7번은 충분히 우연으로 가능하니까요.
- **교정•윤문**: 사람이 쓴 글을 문법만 고쳤다면 AI가 고른 토큰이 몇 개 안 돼서 거의 안 잡힙니다.
- **번역∙초안 작성**: 모든 단어를 AI가 새로 고르니까 식별이 강하게 남습니다.

#### temperature와의 관계
temperature는 logit을 $T$로 나눈 뒤 softmax에 넣는 값입니다. $T$가 크면 분포가 평평해지고(엔트로피 ⬆️), 작으면 1등에 몰립니다(엔트로피 ⬇️). 즉 temperature가 높을수록 워터마크가 심어질 자리가 많아지고, 낮을수록 줄어듭니다. 극단적으로 $T = 0$인 greedy decoding은 주사위를 아예 굴리지 않으니까, 샘플링 기반 워터마크가 개입할 틈이 원리적으로 없습니다. 같은 모델, 같은 프롬프트라도 디코딩 설정에 따라 탐지 난이도가 달라질 수 있다는 뜻입니다.

#### 워터마크 종류

| 종류         | 적용 방식       | 적용 위치   | ctrl + cv |
| ---------- | ----------- | ------- | --------- |
| 통계적 워터마크   | 단어 선택의 편향   | 텍스트 자체  | 살아남음      |
| C2PA 메타데이터 | 서명된 출처 라벨   | 파일 컨테이너 | 사라짐       |
| 제로폭 문자     | 보이지 않는 유니코드 | 글자 사이   | 쉽게 제거됨    |

구글링을 좀 해보니까 watermark-remover 같은 기술은 다들 숨은 문자를 지우거나 폰트를 바꾸거나 하는 방식으로 구현되고 있었습니다. 이건 그냥 텍스트만 보고 AI가 사용하는 문자가 아닌 일반 공백, 하이픈 등으로 글의 형식을 치환해주는 도구이기에, 통계적 워터마크를 검출하고 제거하는 데에는 실질적으로 효과가 없습니다. 간혹 문장 배치나 단어 선택 자체를 바꿔버리는 경우도 있던데, 그건 그냥 글을 새로 써버리는 느낌이라 효과가 있다고 할 수 있습니다. 신호가 정확한 토큰 순서에만 있으니, 순서가 바뀌면 그만큼 서명이 깨질테니까요. OpenAI가 이 부분을 수치화해서 보여줬는데, 400개 토큰 구간에서

- 단어 10%를 동의어로 바꾸면 탐지율이 약 92% → 66%
- 25%를 바꾸면 약 17%

까지 떨어졌습니다.

패러프레이즈, 번역, 대량 편집 등이 다 같은 원리로 워터마크를 지웁니다. 2023년 Krishna [Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense](https://proceedings.neurips.cc/paper_files/paper/2023/hash/575c450013d0e99e4b0ecf82bd1afaa4-Abstract-Conference.html)논문에서 다른 LLM으로 패러프레이즈하면 워터마크 탐지가 무너진다는 걸 이미 보였고, 워터마크를 도입한 회사들도 전부 이 한계를 문서에 명시하고 있습니다.

## 결론
결국 워터마크는 작정하고 숨기려는 사람을 잡는 도구보다는, 별다른 가공 없이 돌아다니는 AI 텍스트에 기계가 읽을 수 있는 **출처 표시를 남기는 도구** 정도로만 생각하는게 맞는 것 같습니다. 탐지된다고 "AI가 썼다"라고 하기도 애매하고, 안 잡힌다고 "사람이 썼다"라고 하기에도 애매한거죠. 글이 짧거나, 고쳐 썼거나, 번역했거나, 아예 다른 회사 모델이었을 수도 있으니까요.

그리고 다시 써서 워터마크를 지운 글이 사람이 쓴 글이 되는 것도 아니잖아요. 그냥 AI는 글쓰는 여러가지 도구 중 하나일 뿐.. 그 글도 어떤 인간이 썼을테니, 나쁜 컨텐츠를 제대로 필터링하는 기술이나 스스로 출처를 제대로 밝히게끔 하는 아이디어를 만드는게 더 중요하다고 봅니다.

저는 개인적으로 [notbyai badge](https://notbyai.fyi/) 이 사이트가 인상깊었는데요, 글, 영상 등의 창작물을 90% 이상 본인이 만들면 스스로가 뱃지를 다는겁니다. 광고 이런거 보면 "AI로 만든 영상입니다" 같은 문구가 뜨잖아요, 근데 하도 AI 생성물이 많아지니까 이제는 사람이 직접 만든게 더 희귀해지고 모두에게 알려야하는 세상이 와버렸네요.

## Reference
- [vizensoft, 클로드 워터마크 제거 도구, 실효성 논란](https://www.vizensoft.com/about/itinsight/read?no=824)
- [Google, SynthID](https://deepmind.google/models/synthid/)
- [OpenAI, Our approach to EU text provenance rules](https://openai.com/index/eu-text-provenance/)
- [ProofreaderPro.AI, OpenAI Watermark, Google SynthID and Claude: AI Text Watermarking in 2026](https://proofreaderpro.ai/blog/ai-watermarking-explained-openai-google-claude)
- [Anthropic, How Claude’s text watermark works](https://www.anthropic.com/news/claude-text-watermark)
- [Sumanth Dathathri et al. (2024), Scalable watermarking for identifying large language model outputs, Nature](https://www.nature.com/articles/s41586-024-08025-4)
- [Kalpesh Krishna et al. (2023), Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense, NeurIPS](https://proceedings.neurips.cc/paper_files/paper/2023/hash/575c450013d0e99e4b0ecf82bd1afaa4-Abstract-Conference.html)
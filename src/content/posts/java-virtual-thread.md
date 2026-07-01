---
title: "Java Virtual Thread"
date: 2026-06-18
tags: ["Java", "JVM", "Async"]
category: "Computer Science/Operating System"
description: "Virtual Thread 란? 버추얼 스레드(Virtual Thread)는 Java 21에서 정식화된, 동시성 처리 방식을 근본적으로 바꾼 기능입니다. 기존 Java의 스레드 모델은 Native Thread로, Java의 유저 스레"
---

# Virtual Thread 란?
<b>버추얼 스레드(Virtual Thread)</b>는 Java 21에서 정식화된, 동시성 처리 방식을 근본적으로 바꾼 기능입니다.

기존 Java의 스레드 모델은 Native Thread로, Java의 유저 스레드를 만들면 Java Native Interface(JNI)를 통해 커널 영역을 호출하여 OS가 커널 영역을 생성하고 1:1로 매핑하여 작업을 수행하는 형태였습니다.

![](/attachments/cs_jvt_1.png)

문제는 이게 비싸다는 점인데, 하나당 메모리 `~2MB`,  생성시간 `~1ms`, 컨텍스트 스위칭 시간 `~100μs`가까이 나온다. 때문에 수천 개씩 못 만들고 스레드 풀로 개수를 제한해야 합니다.

근데 전형적인 서버 작업(DB 조회, 외부 API 호출)은 대부분의 시간을 I/O 대기(블로킹)로 보내고, 스레드가 응답을 기다리는 동안 아무 일도 안하고 자원만 점유합니다. 이에 대한 2가지 해결책이 있습니다.
- 리액티브/비동기 (WebFlux, CompletableFuture) - 처리량은 좋지만 콜백 지옥, 디버깅 지옥, 함수 색칠 
- Virtual Thread - 동기식 블로킹 코드를 그대로 쓰면서 처리량을 확보

![](/attachments/cs_jvt_2.png)
Virtual Thread는 기존 Java의 스레드 모델과 달리, 플랫폼 스레드와 가상 스레드로 나뉩니다. 플랫폼 스레드 위에서 여러 Virtual Thread가 번갈아 가며 실행되는 형태로 동작하는데, 마치 커널 스레드와 유저 스레드가 매핑되는 형태와 비슷합니다.

Virtual Thread는 메모리 `~10KB`, 생성시간 `~1μs`, 컨텍스트 스위칭 시간 `~10μs` 로, 비용이 저렴합니다.

<div class="callout-box" data-callout="note">
<div class="callout-box-title"><span class="callout-box-icon">🗒️</span>스레드 계층</div>

![](/attachments/cs_jvt_3.png)
**1. 네이티브 스레드 = OS 스레드 = 커널 스레드**
운영체제 커널이 직접 만들고 스케줄링하는 "진짜" 스레드(ex. Linux의 pthread). CPU 코어 위에서 실제로 돌아가는 실행단위이고, 커널이 관리하기 때문에 비쌉니다.

**2. 플랫폼 스레드 (Platform Thread)**
`java.lang.Thread`가 네이티브 스레드를 1:1로 얇게 감싼 것. 자바에서 `new Thread()`로 만들던 그 스레드가 전부 플랫폼 스레드 입니다.

- Q. 그럼 왜 갑자기 "플랫폼 스레드"라는 이름이 생겼지?
- A. Java 21에서 버추얼 스레드가 등장하면서 Thread가 두 종류로 나뉘었기 때문에 구분 목적.

**3. 캐리어 스레드 (Carrier Thread)** - 타입이 아니라 역할
캐리어 스레드는 별도의 스레드 종류가 아니라, **버추얼 스레드를 실행 중인 플랫폼 스레드**를 부르는 이름입니다. VT를 등에 업고(carry) 있어서 캐리어라고 부르며, VT가 언마운트되면 그 플랫폼 스레드는 캐리어 역할을 잠시 내려놓고 다른 VT를 태웁니다.

**4. 버추얼 스레드 (Virtual Thread)**
JVM이 관리하는 경량 스레드. 네이티브 스레드와 1:1이 아니라 소수의 캐리어 위에 M:N으로 얹힙니다. 타입은 여전히 `java.lang.Thread`라서 코드 호환이 되고, 스택이 힙에 저장되기에 수십만 개 생성이 가능합니다.


</div>


# Virtual Thread의 구조
![](/attachments/cs_jvt_5.png)
우선 Platform Thread의 기본 스케줄러는 `ForkJoinPool`을 사용하는데, 스케줄러는 platform thread pool을 관리하고, Virtual Thread의 작업 분배 역할을 합니다.

![](/attachments/cs_jvt_7.png)
디버거를 통해 런타임의 Virtual Thread를 살펴보면,
- `carrierThread`는 실제로 작업을 수행시키는 platform thread를 의미하며, `workQueue`를 가짐
- `scheduler`라는 `ForkJoinPool`을 가짐. carrier thread의 pool 역할을 하고, 가상 스레드의 작업 스케줄링을 담당
- `runContinuation`이라는 실제 작업 내용(Runnable)을 가짐

### Virtual Thread의 동작 원리
![](/attachments/cs_jvt_6.png)

1. 실행 대기 Runnable Queue의 `runContinuation`을 carrier thread의 Work Queue에 마운트(unpark()) 합니다.
2. Work Queue의 `runContinuation`들은 `ForkJoinPool`에 의해 **work stealing**(각 캐리어가 자기 작업 큐를 갖고, 놀고 있으면 다른 캐리어 큐에서 작업을 훔쳐옴) 방식으로 Carrier Thread에 의해 처리됩니다.
3. 처리되던 `runContinuation`들은 블로킹 작업(I/O), Sleep으로 인한 interrupt나 작업 완료 시, Work Queue에서 언마운트(pop)되어, `park()` 과정에 의해 다시 힙 메모리로 되돌아갑니다.
4. carrier는 즉시 다른 버추얼 스레드를 실행합니다.
5. I/O가 끝나면 그 Virtual Thread가 아무 carrier에나 다시 마운트돼서 이어 실행됩니다.

-> 그래서 Virtual Thread의 스택은 OS 스레드처럼 고정 크기가 아니라 힙에서 필요한 만큼만 차지하고, 바로 이게 수십만 개를 만들 수 있는 이유가 됩니다.

# 스레드 모델 간 비교
다음은 Ngrinder 기반 성능 테스트 결과입니다.  

테스트는 애플리케이션 스펙을 최소 사양으로 두고, 256MB의 힙 사이즈를 사용하도록 설정했으며, 300ms를 sleep하는 API를 3번 호출하는 Request I/O Bound 작업, 0~300000000까지 합을 3번 계산하는 CPU Bound 작업으로 진행되었습니다.
### Thread vs Virtual Thread

```java
public String ioBound() {
        requestSleep().block(); //Thread.sleep(300) API 호출
        requestSleep().block();
        requestSleep().block();

    return "ok";
}

public Integer cpuBound() {
        IntStream.range(0, 300000000).reduce(0, Integer::sum);
        IntStream.range(0, 300000000).reduce(0, Integer::sum);
        return IntStream.range(0, 300000000).reduce(0, Integer::sum);
}
```
![](/attachments/cs_jvt_8.png)
I/O Bound 작업에서 **Virtual Thread의 성능은 Thread 모델에 비해 약 51% 이상 향상**되었습니다.

우선 적절한 vuser 수를 설정하기 위해 테스트를 해보았는데, Ngrinder의 동시 요청 수를 계속해서 늘리다 보니 **vuser(가상 사용자 수)가 250이 넘어가는 시점부터 Thread 모델에서는 서버가 죽고 응답을 정상적으로 주지 못하는 상황**이 발생했습니다. 반면 virtual thread를 사용하는 서버는 동일한 vuser수를 장애 없이 정상 처리했습니다.

반면 CPU Bound 작업에서는 일반 스레드 모델이 성능상 우위를 보였습니다. 경량 스레드가 결국 플랫폼 스레드 위에서 동작하기 때문에, CPU Bound 작업과 같은 Virtual Thread가 Switching 되지 않는 경우에는 Platform Thread 사용 비용뿐만 아니라 Virtual Thread 생성 및 스케줄링 비용까지 포함되어 성능 낭비가 발생되기 때문입니다.

> **It is more expensive to run a task in a virtual thread than running it in a platform thread.** (Java Youtube, Java 21 new feature: Virtual Threads)

### Virtual Thread vs Kotlin Coroutine
```kotlin
fun ioBound(): String? {
    return CoroutineScope(Dispatchers.IO).async {
        requestSleep().awaitFirstOrNull() // api call
        requestSleep().awaitFirstOrNull()
        requestSleep().awaitFirstOrNull()
    }.await();
}
```
![](/attachments/cs_jvt_9.png)
코루틴 모델은 앞서 테스트한 스레드 모델보다 더 많은 처리량을 가지기 때문에, 이전 테스트의 vuser의 4배인 510으로 두고 I/O bound 요청 테스트를 진행하였습니다. 성능테스트 결과 **Virtual Thread의 성능이 Kotlin coroutine에 비해 37% 좋은 성능**을 보였습니다.

<div class="callout-box" data-callout="note">
<div class="callout-box-title"><span class="callout-box-icon">🗒️</span>코루틴</div>

Kotline Coroutine은 virtual thread이 JDK 자체적으로 지원하는 것과는 다르게, 코드 레벨에서 Kotlin 컴파일러의 마법으로 구현이 가능합니다. Coroutine은 **중단(suspend)했다가 나중에 그 지점부터 재개(resume)할 수 있는 함수**로, 협력적 멀티태스킹(cooperative multitasking)의 단위입니다.

![](/attachments/cs_jvt_11.png)
![](/attachments/cs_jvt_12.png)
간단하게 코루틴의 동작 원리를 살펴보면,
1. suspend 함수를 Continuation과 지역변수를 가진 클래스로 만듭니다.
2. 첫 번째 그림처럼 suspend 메서드 내에 호출하고 있는 suspend 함수가 2개의 지점이 있다면, suspend 함수 호출 부분을 기점으로 suspend point로 지정합니다.
3. 각각의 suspend point를 기준으로 label(L0, L1, L2)을 나눠 switch(when)문으로 finite state machine 처럼 코드를 Generate 합니다.
4. `fetchUser()`, `fetchProfile()` 과 같은 park/unpark가 필요한 I/O 발생지점과 같은 부분은 위에서 보이는 `.await()`와 같은 Kotlin 확장함수를 통해 park/unpark를 가능하게 합니다.

</div>

Virtual Thread는 기존의 Thread 방식을 완전히 대체하기 때문에, TaskExecutor를 교체하여 어플리케이션 전체에 적용할 수 있습니다. 반면 **Coroutine은 메서드 단위로 원하는 곳에만 경량스레드를 적용**할 수 있다는 장점이 있습니다.

코루틴은 JDK21 이전의 버전에서도 경량스레드를 적용할 수 있다는 장점을 가지고 있습니다. 이는 JDK의 최신버전을 바로 적용하기 어려운 상황에서 최선의 선택이 될 수 있습니다.

그러나 Coroutine은 suspend 진입 전 플로우는 경량 스레드가 아닌 일반 스레드로 처리되고, I/O Block 이나 sleep 같은 Thread park/unpark(컨텍스트 스위칭)가 필요한 순간마다 Kotlin이 만들어놓은 suspend 확장함수를 사용해야 하므로 **프로덕션 코드에 변경**이 필요합니다.

그리고 Reactive Streams 패러다임과 마찬가지로, **suspend function들은 역시 전염성이 있어서** suspend가 전파될 수 있다는 함수의 색 문제가 있습니다.

### Virtual Thread vs Reactive Programming
```java
public Mono<String> ioBound() {
      return requestSleep()
          .flatMap(it -> requestSleep())
          .flatMap(it -> requestSleep())
}
```
![](/attachments/cs_jvt_10.png)리액티브 스레드 모델 또한, vuser를 앞서 테스트한것의 4배인 510으로 두고 I/O bound 요청을 통해 진행하였습니다. 성능테스트 결과 Virtual Thread의 성능이 Reactive에 비해 111% 좋은 성능을 보였습니다.

Spring의 Reactive 프로그래밍 모델인 WebFlux는 Netty의 event loop 기반으로 동작합니다. Event loop가 중심에서 모든 요청을 처리하고, 요청 처리 구간을 callback으로 등록해놓고, worker 스레드 풀이 작업들을 처리하는 형태입니다. Worker 스레드가 작업을 처리하는 과정에서 I/O를 마주치게 되면 작업이 park 되면서 컨텍스트 스위칭이 발생합니다.

![](/attachments/cs_jvt_13.png)  ![](/attachments/cs_jvt_14.png)

위 코드를 보면 동기로 짜여있던 코드는 직관적이었던 반면 reactive 프로그래밍으로 짜인 코드는 다소 파편화 되어 있는 모습입니다. if문이나 try/catch 구문들이 모두 메서드 단위로 분리되어 있기 때문인데, 이는 Java의 기본적인 syntax를 활용하기 어렵게 하여, 코드의 흐름을 이해하기 어렵게 만들 수 있습니다.

또한 reactive 프로그래밍은 **함수의 색 문제**를 가지고 있어, park/unpark 사용되는 부분마다 Reactive가 적용되어야 하고, 이는 플로우 전체에서 reactive streams를 사용해야하는 문제점이 존재합니다.

마지막으로 컨텍스트 스위칭시 실제 스레드를 switch 하기 때문에, **경량스레드 switch에 비해 성능 낭비**가 존재하고, 스레드의 컨텍스트를 상실하기 때문에 스택 트레이스가 유실된다는 단점도 존재합니다. 이는 디버그를 어렵게 만들 수 있습니다.

# 주의사항
- **No pooling**
    - Virtual Thread는 값싼 일회용품이라고 보면 됩니다. **생성비용이 작기 때문에 스레드 풀을 만드는 행위 자체가 낭비가 될 수 있습니다**. 필요할 때마다 생성하고 GC(Garbage Collector)에 의해 소멸되도록 방치해버리는게 좋습니다.
    
- **CPU bound 작업엔 비효율**
    - 앞선 테스트에서 봤듯이 IO 작업 없이 **CPU 작업만 수행하는것은, 플랫폼 스레드만 사용하는것보다 성능이 떨어집니다**. 컨텍스트 스위칭이 빈번하지 않은 환경이라면, 기존 스레드모델을 사용하는것이 이득입니다.
    
- **Pinned issue**
    - Virtual thread 내에서 `synchronized` 나 `parallelStream` 혹은 네이티브 메서드를 쓰면 virtual thread가 carrier thread에 park 될 수 없는 상태가 되어버립니다. 이를 **Pinned(고정된)** 상태라고 하는데, 이는 예상한 virtual thread의 성능저하를 유발할 수 있습니다. 그래서 **21에서는 `ReentrantLock`을 쓰라고 권장**했었습니다. 
      근데 Java 24/25(JEP 491)에서 synchronized 피닝이 해결돼서, 25 기준으로는 모니터 관련 피닝은 거의 사라지고 네이티브 호출 같은 일부 코너 케이스만 남았습니다. 그래도 JNI 네이티브 블로킹은 여전히 피닝되니 주의.
    
- **Thread local**
    - Virtual Thread는 수시로 생성되고 소멸되며 스위칭됩니다. 백만개의 스레드를 운용할 수 있도록 설계되었기 때문에, 항상 크기를 작게 유지하는게 좋습니다.


## Reference
- [우아한 기술 블로그, Java의 미래, Virtual Thread](https://techblog.woowahan.com/15398/)
- [Naver D2, Virtual Thread의 기본 개념 이해하기](https://d2.naver.com/helloworld/1203723)
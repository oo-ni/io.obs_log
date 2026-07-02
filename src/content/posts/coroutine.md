---
title: "Coroutine"
date: 2026-06-22
tags: ["Java", "Kotlin", "Async"]
category: "Computer Science/Programming Language"
description: "정의 서브루틴의 일반화 코루틴은 1958년 멜빈 콘웨이가 만든, CS에서 가장 오래된 개념 중 하나입니다. 서브루틴(=함수)을 일반화한 것으로: 서브루틴: 진입점 1개, 끝까지 실행 → return 1번. 호출되면 호출자에게 종속(c"
---

# 정의 - 서브루틴의 일반화
코루틴은 1958년 멜빈 콘웨이가 만든, CS에서 가장 오래된 개념 중 하나입니다. 서브루틴(=함수)을 일반화한 것으로:
- 서브루틴: 진입점 1개, 끝까지 실행 → return 1번. 호출되면 호출자에게 종속(caller-callee)
- 코루틴: 진입/탈출 지점이 여러 개. 실행 도중 제어를 양보하고, 그 시점의 로컬 상태를 보존한 채 멈췄다가(suspend), 재개되면 그 자리부터 이어감
![](/attachments/cs_crt_1.png)

그래서 **협력적(cooperative) 멀티태스킹**이라고 부릅니다. 강제로 쫓겨나는게 아니라 스스로 양보 지점에서 제어권을 넘기기 때문입니다. 버추얼 스레드 스케줄링이나 asyncio 이벤트 루프 등이 이런 방식인데, 둘 다 코루틴의 일종이거나 그 위에서 만들어진 것이라 할 수 있습니다.

### 두 가지 핵심 분류
코루틴은 활용 언어에 따라 두 축으로 분류됩니다.

<b>대칭(symmetric) vs 비대칭(asymmetric)</b>
- **대칭**: 코루틴끼리 서로에게 직접 제어를 넘길 수 있습니다. 호출 계층이 X (Lua)
- **비대칭**: 코루틴이 yield하면 **자기를 부른쪽(resumer)에게만** 제어를 돌려줍니다. 부모-자식 관계가 고정 (Python, Kotlin)

<b>스택리스(stackless) vs 스택풀(stackful)</b> ⭐️
- **스택리스**: 코루틴이 **최상위 함수 본문에서만** 중단할 수 있으며, 중첩 호출 깊은 곳에서는 못 멈춥니다. 상태를 힙에 올린 **상태 머신 하나**로 표현합니다. 컴파일러가 변환합니다. (Python async, JS async/await, C# async, 코틀린 코루틴, Rust async)
- **스택풀**: 코루틴이 **자기만의 완전한 스택**을 갖기에, 호출 깊이 상관없이 아무데서나 중단 가능합니다. 거의 스레드처럼 동작합니다. (Lua 코루틴, Ruby 파이버, Go 고루틴, 자바 버추얼 스레드)

# 코루틴의 구성 요소
JetBrains 공식 문서는 코루틴을 만들려면 다음의 4가지 재료가 필요하다고 명시합니다.
1. `suspend` 함수
2. 그 안에서 돌릴 코루틴 스코프
3. `launch` 같은 코루틴 빌더
4. 어느 스레드를 쓸지 정하는 디스패처

```kotlin
suspend fun main() = withContext(Dispatchers.Default) {   // 스코프 + 디스패처
	launch { greet() }   // 빌더 + suspend 함수
}
```
![](/attachments/cs_crt_2.png)
### 1. suspend 함수 (WHAT)
가장 기본 단위로, `suspend` 키워드를 붙이면 그 함수는 중단/재개가 가능해집니다.
```kotlin
suspend fun greet() {
	delay(1000)
	println("hello")   // 스레드를 막지 않고 1초 "중단"
}
```

그리고 함수 색이 여기서 명시적으로 드러납니다. suspend 함수는 오직 다른 suspend 함수 안에서만 호출할 수 있습니다. 진입점까지 색을 칠하려면 `suspend fun main()`. 못 칠하는 환경(프레임워크 등)이면 `runBlocking`으로 다리를 놓습니다.

### 2. 빌더 (launch / async / runBlocking) (HOW)
`launch` - 결과가 필요없을 때. `Job` 핸들을 반환해서 취소/대기에 씁니다.
```kotlin
launch { sendNotification() }
```

`async` - 결과가 필요할 때. `Deferred<T>`를 반환하고 `.await()`로 결과를 기다립니다. 여러 개를 동시에 띄우고 합류시키는게 핵심 패턴입니다.
```kotlin
val a = async { fetchPageA() }   // 동시 시작
val b = async { fetchPageB() }
val equal = a.await() == b.await()   // 둘 다 끝나면 합류 (병렬 처리)
```
이게 promise/future가 하던 일을 suspend로 자연스럽게 하는 부분입니다. `.then()` 체인 없이 그냥 `async` 나열 후 `await()`를 사용하는 것.

`runblocking` - suspend 세계와 블로킹 세계의 다리 역할로, 현재 스레드를 막고 안의 코루틴이 끝날 때까지 기다립니다. suspend 코드를 비-suspend 코드에서 불러야 하는데, 다른 방법이 없을 때만 써야합니다. (main 함수나 테스트 진입점 등에서 주로 활용)

### 3. 구조적 동시성 (scope) (WHEN)
코루틴은 부모-자식 트리를 이루고 수명이 서로 연결됩니다. 부모는 자식이 다 끝날때까지 완료되지 않고, 부모가 실패하거나 취소되면 모든 자식 코루틴이 재귀적으로 취소됩니다.
```kotlin
coroutineScope {         // 부모
	launch { taskA() }   // 자식 1
	launch { taskB() }   // 자식 2
}   // A와 B가 둘 다 끝나야 이 줄을 통과. 하나가 터지면 나머지도 취소.
```
이렇게 되면, 코루틴 누수가 구조적으로 불가능해집니다. 부모 스코프를 벗어나면 떠도는 자식이 남을 수 없기 때문입니다. 콜백/promise 때는 실행은 했는데 아무도 안 기다리는 좀비 비동기 작업이 흔했는데, 그걸 언어 레벨에서 막은 것입니다.

### 4. 디스패처 (WHERE)
디스패처는 코루틴이 어느 스레드/스레드 풀을 쓸지 정합니다. 코루틴은 한 스레드에 묶이지 않아서, 한 스레드에서 중단했다가 다른 스레드에서 재개될 수 있습니다. 종류는 다음과 같습니다:
- `Dispatchers.Default` - CPU 집약 작업(데이터 처리 등)용, 공유 스레드 풀에서 실행, 스레드 수 = CPU코어 수(최소 2개)
- `Dispatchers.IO` - 블로킹 I/O용 큰 풀. 대기가 많아도 견딜 수 있도록 스레드 많음
- `Dispatchers.Main` - UI 스레드 (안드로이드/데스크톱)

### 전체 코드
```kotlin
suspend fun loadUser() =           // 1. suspend — 일감 정의
    withContext(Dispatchers.IO) {  // 4. 디스패처 — IO 사무실에서
        coroutineScope {           // 3. 스코프 — 이 안의 코루틴 수명 관리
            val profile = async { api.getProfile() }  // 2. 빌더(async) — 결과 받는 코루틴
            val posts   = async { api.getPosts() }    // 2. 병렬로 하나 더
            User(profile.await(), posts.await())      // 둘 다 수확해서 반환
        }
    }
```
**"suspend  함수(1)를, IO 스레드(4)에서, 하나의 스코프(3)로 묶어서, async 빌더(2) 두 개를 병렬로 돌리고 합류"** 합니다. 위의 4가지 재료가 각자 다른 질문에 대답하면서 코루틴을 구성합니다.


# 함수의 상태 유지
위의 디스패처를 통해 코루틴이 다른 스레드에서 재개되더라도, 중단 전에 쓴 값들은 재개 시 같은 코루틴 안에서 그대로 로컬 상태가 보장됩니다. 이는 **상태가 스레드가 아니라 힙의 컨티뉴에이션 객체에 저장되기 때문**입니다. 그원리를 알아봅시다.

중단 함수는 함수가 시작할 때와 중단 함수가 호출되었을 때 서로 다른 상태를 가진다는 점에서 <b>상태 머신(state machine)</b>과 비슷합니다. 컴파일러는 각 중단점(suspension poitn)을 하나의 상태로 삼아 함수를 상태별로 쪼개는데, 이를 가능하게 하는 것이 **CPS 변환**입니다.

### CPS, continuation-passing style
suspend 함수엔 `Continuation`이 마지막 파라미터로 추가되고, 반환 타입이 `Any`로 바뀝니다.
```kotlin
suspend fun myFunction() {
    println("Before")
    delay(1000)          // 중단점
    println("After")
}
```
```kotlin
fun myFunction(continuation: Continuation<Unit>): Any
```
반환 타입이 `Any`인 이유는 중단되면 실제 값 대신 COROUTINE_SUSPEND 마커를 변환할 수 있기 때문입니다. suspend 함수마다 컨티뉴에이션을 갖기 때문에 suspend 함수 안에서만 호출이 가능합니다(함수의 색).

그리고 함수 본문은 중단점으 기준으로 상태가 나뉘어, `label`을 보고 해당 상태로 진입하는 형태로 변환됩니다.
```kotlin
fun myFunction(continuation: Continuation<Unit>): Any {
    val cont = continuation as? MyFunctionContinuation
        ?: MyFunctionContinuation(continuation)

    if (cont.label == 0) {
        println("Before")
        cont.label = 1                        // 다음 상태 예약
        if (delay(1000, cont) == COROUTINE_SUSPENDED)
            return COROUTINE_SUSPENDED         // 중단 → 스레드 반환
    }
    if (cont.label == 1) {
        println("After")
        return Unit
    }
    error("Impossible")
}
```

컨티뉴에이션(continuation) 객체는 상태를 나타내는 숫자와 로컬 데이터를 가지고 있습니다. 이 점이 상태 유지에 대한 근본적 답입니다. **지역 변수와 파라미터가 스레드의 스택이 아니라 이 객체의 필드에 담기기에, 어느 스레드에서 재개하든 이 객체만 있으면 값이 그대로 복원됩니다.**
```kotlin
class MyFunctionContinuation(
    val completion: Continuation<Unit>        // 나를 호출한 쪽 (= 다음에 재개할 대상)
) : Continuation<Unit> {
    var label = 0                             // 상태를 나타내는 숫자
    var counter = 0                           // 지역 변수가 필드로 올라감 (hoisting)
    // ...
}
```

예를 들어 `counter` 같은 지역 변수는 중단점을 넘어 살아남아야 하므로, 스택이 아니라 위처럼 컨티뉴에이션의 필드로 끌어올려집니다(hoisting). 그래서 함수 본문은 재개 시 필드에서 값을 복원해 이어갑니다.
```kotlin
fun myFunction(continuation: Continuation<Unit>): Any {
    val cont = /* ... */
    var counter = cont.counter                // 재개 시 필드에서 복원

    if (cont.label == 0) {
        println("Before")
        counter = 0
        cont.counter = counter                // 중단 전 필드에 저장
        cont.label = 1
        if (delay(1000, cont) == COROUTINE_SUSPENDED)
            return COROUTINE_SUSPENDED
    }
    if (cont.label == 1) {
        counter = cont.counter                // 다른 스레드에서 재개돼도 여기서 복원
        counter++
        println("Counter: $counter")
        println("After")
        return Unit
    }
    error("Impossible")
}
```

컨티뉴에이션 객체는 콜 스택으로 사용됩니다. 코루틴이 중단되면 스레드를 반환하고 그 스레드의 콜 스택 정보는 사라지는데, 재개 시점에는 이미 콜 스택이 없으므로 컨티뉴에이션 객체가 그 역할을 대신합니다. 한 함수의 컨티뉴에이션 객체가 자신을 호출한 함수의 컨티뉴에이션 객체를 감싸는 것을 **장식(decorate)** 이라고 하며, `a() → b() → c()`처럼 호출이 이어지면 컨티뉴에이션이 겹겹이 중첩된 체인을 이룹니다. 이 체인 전체가 곧 **힙에 재구성된 콜 스택**입니다.

재개는 이 구조를 그대로 이용합니다. 중단 시 `label`과 지역 변수를 컨티뉴에이션에 저장하고 스레드를 반환하며, 재개될 때 `resumeWith`가 `label`을 읽어서 해당 상태로 점프하고 변수를 복원합니다.
```kotlin
override fun resumeWith(result: Result<Unit>) {
    val res = try {
        val r = myFunction(this)              // label을 보고 해당 상태부터 재개
        if (r == COROUTINE_SUSPENDED) return  // 또 중단되면 여기서 멈춤
        Result.success(r as Unit)
    } catch (e: Throwable) {
        Result.failure(e)
    }
    completion.resumeWith(res)                // 끝나면 호출자를 재개 (위로 전파)
}
```

함수가 완료되면 자신을 호출한 함수의 컨티뉴에이션을 재개하므로, `c() → b() → a()`의 역순으로 전파되며 콜 스택을 되감듯 올라갑니다.

## Reference
- [Kotlin Documentation, Coroutines guide](https://kotlinlang.org/docs/coroutines-guide.html)
- [Android Developers, Kotlin coroutines on Android](https://developer.android.com/kotlin/coroutines)
- [김누누, 코루틴의 실제 구현](https://jinudmjournal.tistory.com/194)
- [Stack Overflow, Why kotlin coroutines are considered light weight?](https://stackoverflow.com/questions/63719766/why-kotlin-coroutines-are-considered-light-weight)
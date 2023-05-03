---
title: C++ 20 协程乱炖 
date: 2023-05-03 20:33:35
tags: ["C++", "协程"]
---

不对 C++ 20 里的协程做过多的基础介绍，别人讲得好多了
仅作为俺的笔记使用，理解可能存在问题，欢迎指正

> https://zh.cppreference.com/w/cpp/language/coroutines 圣经
>
> https://zhuanlan.zhihu.com/p/561623494 图不错
>
> https://uint128.com/2022/02/21/%E7%90%86%E8%A7%A3C-20-Coroutine-co-await%E4%B8%8EAwaiter/ 字多
>
> https://sf-zhou.github.io/coroutine/cpp_20_coroutines.html 例子挺好

### Notes

- 应该无需多言，C++ 的 coroutine 只是编译器把协程函数转化为了状态机，没有提供运行时，若协程执行顺序有先后关系，则应通过外部的调度机制处理

- 那个 coroutine_handle 就只包了个 `void* frame_ptr` 放协程帧的，frame_ptr 一样指代的协程对象就一样

- Awaiter 的 `await_suspend` 可以用来写协程先后关系的调度，传入的 handle 是父，如果自己也是协程那 this->handle 就是子；`await_resume` 不是 `coro_handle.resume`，不是负责恢复协程的，只是用来取结果的，俺这个猪脑咋就记不住呢

- 对于有返回值的协程函数应使用返回值为 `always_suspend` 的 `final_suspend` 函数，否则会像拉稀一样在 `promise.return_value(val)` 后直接给 coro_frame 连着里面的 promise 一起 delete 了，`always_suspend` 会把协程控制交还给上级，此时 `coro_handle.done()` 为 `true`，按标准不应再次恢复协程的运行，资源应留给上级释放，反编译显示无所谓
  > https://zh.cppreference.com/w/cpp/language/coroutines “调用 promise.final_suspend() 并 co_await 它的结果（例如，以恢复某个继续或发布某个结果）。此时开始恢复协程时的行为未定义”

```c++
// suspend_always
case 7u:
    ...;
    frame_ptr->_Coro_promise.m_value = 12;
    frame_ptr->_Coro_resume_fn = 0LL;
    frame_ptr->_Coro_resume_index = 8;
    return;
case 8u:
    operator delete(frame_ptr);

// suspend_never
case 7u:
    ...;
    frame_ptr->_Coro_promise.m_value = 12;
    frame_ptr->_Coro_resume_fn = 0LL;
    goto LABEL_43;
case 8u:
LABEL_43:
    operator delete(frame_ptr);
```

  
- 坑，Promise 对象应该扬掉复制构造函数和赋值符，因为当一个 promise 被协程函数的声明所创建时，会优先寻找与这个协程函数参数所匹配的 promise 构造函数，即 `Task<int> foo(double d) -> Promise(double)` ，这个设计属实是傻逼，说是可以传个 Logger 之类的进去，但明显鸡肋，也不知道为什么
  > https://zh.cppreference.com/w/cpp/language/coroutines “调用承诺对象的构造函数。如果承诺类型拥有接收所有协程形参的构造函数，那么以复制后的协程实参调用该构造函数。否则调用其默认构造函数。”
  > https://devblogs.microsoft.com/oldnewthing/20210504-00/?p=105176

- `sizeof(coro_frame)` 在编译期不可知，因为协程主体经过优化后才能决定栈大小，但应该可以用奇技淫巧确定栈的最大值并进行分配
  > https://stackoverflow.com/questions/62705161/how-much-memory-must-be-reserved-for-a-c20-coroutine-frame
  > https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2019/p1745r0.pdf
  > https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2018/p1365r0.pdf

### 协程函数的编译器处理实例

基于 g++ 11.3.0 -Og -std=c++20 的编译结果，反编译并极大的简化了逻辑，与实际存在出入

#### 例程：

```c++
template<typename T>
struct Task {
    struct Promise {
        T value;
        Task<T> get_return_object() {
            return Task<T>{ std::coroutine_handle<Promise>::from_promise(*this) };
        }
        static std::suspend_always initial_suspend() { return {}; }
        static std::suspend_always final_suspend() { return {}; }
        std::suspend_always yield_value(T&& v) { 
            value = v; 
            return {}; 
        }
        void return_value(T&& v) { value = v; }
        void unhandled_exception() {}
    };
    using Handle = std::coroutine_handle<Promise>;
    explicit Task(Handle handle_) : handle(handle_) {}
    bool await_ready() { return handle.done(); }
    T await_resume() { 
        return std::move(handle.promise().value); 
    }
    void await_suspend(std::coroutine_handle<> handle) {}
    Handle handle;
};

Task<int> foo(int a) {
    co_return a+114;
}

Task<int> bar() {
    int a = 514;
    a = co_await foo(a);
    printf("foo 1: %d\n", a);
    a = co_await foo(1919);
    printf("foo 2: %d\n", a);
    co_return 810;
}
```

#### 大概的编译器处理结果：

```c++
struct _foo_frame {
    // something like function body's entry. 
    FunctionEntry* _function_entry;
    FunctionEntry* ...;
    
    // must haves
    int _state;
    Task<int>::Promise _promise;
    std::coroutine_handle<Task<int>::Promise> _self_handle;
    
    // local variables / captures / parameters
    int _param_a;
    
    // some other things the implement added
    DontKnow ...;
};

Task<int> foo(int a) {
    using Handle = std::coroutine_handle<Task<int>::Promise>;
    Handle handle;
    _foo_frame* frame_ptr = new _foo_frame;	// call Promise::new
    handle.frame_ptr = frame_ptr;
    frame_ptr->_function_entry = (void(*)(_foo_frame&))foo;
	frame_ptr->_state = 0;
    frame_ptr->_self_handle = handle;
    frame_ptr->_param_a = a;
    ...; // initialization for frame_ptr's other properties
    
    Task<int> task{handle};
    return task;
}
void foo(_foo_frame& frame) {
    try {
        switch(frame._state) {
            case 0:
                frame._state = 1;
                suspend_awalys.await_suspend(frame._self_handle);	// co_await initial_suspend
                return;		// initial_suspend
            case 1:
                frame._promise.return_value(frame._param_a+114);	// co_return a+114;
                frame._state = 2;
                [[ fallthrough ]]
            case 2:
                frame._state = 3;
                suspend_awalys.await_suspend(frame._self_handle);	// co_await final_suspend
                return;		// final_suspend, coro is done here!
            case 3:			// should never resume here
                delete &frame;	// clean up
                return;
            default:
                BUG();		// something went wrong...
        }
    } catch(...) {
        frame._promise.unhandled_exception();
    	frame._state = 2;
        return;
    }
}
```

```c++
struct _bar_frame {
    // something like function body's entry. 
    FunctionEntry* _function_entry;
    FunctionEntry* ...;
    
    // must haves
    int _state;
    Task<int>::Promise _promise;
    std::coroutine_handle<Task<int>::Promise> _self_handle;
    
    // local variables / captures / parameters / temp variable that need to cross state
    int _local_a;
    Task<int> _temp_foo_1;
    Task<int> _temp_foo_2;
    
    // some other things the implement added
    DontKnow ...;
};

Task<int> bar() {
    using Handle = std::coroutine_handle<Task<int>::Promise>;
    Handle handle;
    _bar_frame* frame_ptr = new _bar_frame; // call Promise::new
    handle.frame_ptr = frame_ptr;
    frame_ptr->_function_entry = (void(*)(_bar_frame&))bar;
	frame_ptr->_state = 0;
    frame_ptr->_self_handle = handle;
    ...; // initialization for frame_ptr's other properties
    
    Task<int> task{handle};
    return task;
}
void bar(_bar_frame& frame) {
    try {
        switch(frame._state) {
            case 0:
                frame._state = 1;
                suspend_awalys.await_suspend(frame._self_handle);	// co_await initial_suspend
                return;		// initial_suspend
            case 1:
                frame._local_a = 514;	// int a = 514;
                frame._temp_foo_1 = foo(frame._local_a); // foo(a);
                frame._state = 2;
                frame._temp_foo_1.await_suspend(frame._self_handle);    // co_await
            	return; // state is divided by co_await
            case 2:
                frame._local_a = frame._temp_foo_1.await_resume();	// a = [await_result];
                printf("foo 1: %d\n", frame._local_a);	// printf("foo 1: %d\n", a);
                frame._temp_foo_2 = foo(1919);	// foo(1919);
                frame._state = 3;
                frame._temp_foo_2.await_suspend(frame._self_handle);    // co_await
                return;	// state is divided by co_await
            case 3:
                frame._local_a = frame._temp_foo_2.await_resume();	// a = [await_result];
                printf("foo 2: %d\n", frame._local_a);	// printf("foo 2: %d\n", a);
                frame._promise.return_value(frame._local_a);	// co_return a;
                frame._state = 4;
                [[ fallthrough ]]
            case 4:
                frame._state = 5;
                suspend_awalys.await_suspend(frame._self_handle);	// co_await final_suspend
                return;		// final_suspend, coro is done here!
            case 5:			// should never resume here
                delete &frame;	// clean up
                return;
            default:
                BUG();		// something went wrong...
        }
    } catch(...) {
        frame._promise.unhandled_exception();
    	frame._state = 4;
        return;
    }
}
```

### 总结

**C++ 标准委员会纯纯的老逼登**

1. 你妈的 async 标识符不用多搞出来这些 co_xxxx，async 后用 return 和 yeild 不好吗？
2. 你这玩意确实定制性够强，但能不能先给个能用的运行时，看完这一套下来人都快麻了，别说写了，另外完全没配套，网络库 C++ 23 了都没见着
3. 那个 promise 的构造函数坑更显老逼登风范，完全不知道实际应用价值
5. 隔壁 rust 通过生命周期都给协程动态内存分配消灭玩明白了，还在这吵吵采用哪个方案来确定协程帧大小比较好，连个方便 workaround 走的路都没有
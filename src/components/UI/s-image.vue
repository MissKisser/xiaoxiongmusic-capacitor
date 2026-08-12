<!-- 图片组件 -->
<template>
  <div ref="imgContainer" :key="src" class="s-image">
    <!-- 加载图片 -->
    <Transition name="fade">
      <img v-if="!isLoaded" :src="defaultSrc" class="loading" alt="loading" />
    </Transition>
    <!-- 真实图片 -->
    <img
      v-if="imgSrc"
      ref="imgRef"
      :src="imgSrc"
      :key="imgSrc"
      :alt="alt || 'image'"
      :class="['cover', { loaded: isLoaded }]"
      :decoding="decodeAsync ? 'async' : 'auto'"
      :loading="nativeLazy ? 'lazy' : 'eager'"
      :style="{ objectFit: objectFit }"
      @load="imageLoaded"
      @error="imageError"
    />
  </div>
</template>

<script lang="ts">
// ---- 共享 IntersectionObserver 单例（模块级，所有图片实例共用） ----
// 列表页存在数百个图片实例，若每个实例独立创建 observer 开销过大，
// 这里共享一个 observer，回调按 entry.target 分发到注册的实例回调集合
const sharedObserver =
  typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          // 按目标元素分发到注册的实例监听回调
          observerTargets.get(entry.target)?.forEach((listener) => {
            listener(entry.isIntersecting);
          });
        });
      })
    : null;
/** 观察目标 -> 该目标上的实例监听回调集合 */
const observerTargets = new Map<Element, Set<(visible: boolean) => void>>();
</script>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    src: string | undefined;
    defaultSrc?: string;
    alt?: string;
    // 图片填充方式
    objectFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
    // 是否进行可视状态变化
    observeVisibility?: boolean;
    // 在不可视时是否释放图片以回收内存
    releaseOnHide?: boolean;
    // 是否使用浏览器异步解码
    decodeAsync?: boolean;
    // 是否使用原生懒加载
    nativeLazy?: boolean;
  }>(),
  {
    defaultSrc: "/images/song.jpg?asset",
    observeVisibility: true,
    releaseOnHide: false,
    decodeAsync: true,
    nativeLazy: true,
    objectFit: "cover",
  },
);

const emit = defineEmits<{
  // 加载完成
  load: [e: Event];
  // 加载失败
  error: [e: Event];
  // 可视状态变化
  "update:show": [show: boolean];
}>();

// 图片数据
const imgRef = ref<HTMLImageElement>();
const imgSrc = ref<string>();
const imgContainer = ref<HTMLImageElement>();

// 是否加载完成
const isLoaded = ref<boolean>(false);
// 可视状态上一次值，避免重复 emit
const lastShowState = ref<boolean | null>(null);
// 加载竞态 token，防止旧图片回调覆盖新状态
const loadToken = ref<number>(0);
const currentToken = ref<number>(0);

// ---- 共享 IntersectionObserver 单例 ----
// 共享 observer 与注册表定义在模块级（见上方 <script> 块），实例内只负责注册/注销

// 是否可视
const isCanLook = ref<boolean>(false);
/** 当前观察中的容器元素 */
let observedEl: Element | null = null;
/** 当前实例的可视状态监听回调 */
let observedListener: ((visible: boolean) => void) | null = null;

/**
 * 将当前容器元素注册到共享 observer
 * 注册前先释放旧目标（根节点 :key="src" 会在换图时重建元素，需同步迁移观察）
 * @param el 容器元素
 */
const registerObserver = (el: Element | undefined) => {
  // 释放旧目标
  if (observedEl && observedListener) {
    const listeners = observerTargets.get(observedEl);
    if (listeners) {
      listeners.delete(observedListener);
      if (listeners.size === 0) {
        observerTargets.delete(observedEl);
        sharedObserver?.unobserve(observedEl);
      }
    }
  }
  observedEl = null;
  observedListener = null;
  if (!el) return;
  // 不支持 IntersectionObserver 的环境视为始终可视，保证图片正常加载
  if (!sharedObserver) {
    isCanLook.value = true;
    return;
  }
  let listeners = observerTargets.get(el);
  if (!listeners) {
    listeners = new Set();
    observerTargets.set(el, listeners);
    sharedObserver.observe(el);
  }
  observedListener = (visible: boolean) => {
    isCanLook.value = visible;
  };
  observedEl = el;
  listeners.add(observedListener);
};

// 容器元素变化时（:key="src" 重建元素）重新注册到共享 observer
watch(imgContainer, (el) => registerObserver(el), { flush: "post" });

// 图片加载完成
const imageLoaded = (e: Event) => {
  // 竞态保护：仅响应最新一次设置的图片
  if (currentToken.value !== loadToken.value) return;
  if (isLoaded.value) return;
  isLoaded.value = true;
  emit("load", e);
};

// 图片加载失败
const imageError = (e: Event) => {
  // 竞态保护
  if (currentToken.value !== loadToken.value) return;
  isLoaded.value = false;
  // 避免默认图也反复触发导致死循环
  if (imgSrc.value !== props.defaultSrc) {
    imgSrc.value = props.defaultSrc;
  }
  emit("error", e);
};

// 可视状态变化（可控）
watch(
  isCanLook,
  (show) => {
    if (!props.observeVisibility) return;
    // 去重：仅在状态变化时触发
    if (lastShowState.value !== show) {
      lastShowState.value = show;
      emit("update:show", show);
    }
    if (show) {
      // 进入可视区再加载，避免重复赋值
      if (imgSrc.value !== props.src) {
        loadToken.value += 1;
        currentToken.value = loadToken.value;
        imgSrc.value = props.src;
      }
    } else if (props.releaseOnHide) {
      // 释放图片以回收内存
      if (imgSrc.value !== undefined) imgSrc.value = undefined;
    }
  },
  { immediate: true },
);

// 监听 src 变化
watch(
  () => props.src,
  (val) => {
    isLoaded.value = false;
    // 不同值时才进行赋值，减少重绘
    if (props.observeVisibility) {
      if (isCanLook.value) {
        if (imgSrc.value !== val) {
          loadToken.value += 1;
          currentToken.value = loadToken.value;
          imgSrc.value = val;
        }
      } else {
        if (props.releaseOnHide) {
          if (imgSrc.value !== undefined) imgSrc.value = undefined;
        }
      }
    } else {
      if (imgSrc.value !== val) {
        loadToken.value += 1;
        currentToken.value = loadToken.value;
        imgSrc.value = val;
      }
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  try {
    if (imgRef.value) imgRef.value.src = "";
  } catch {
    /* empty */
  }
  // 从共享 observer 注销当前目标
  registerObserver(undefined);
  imgSrc.value = undefined;
  imgRef.value = undefined;
  imgContainer.value = undefined;
});
</script>

<style lang="scss" scoped>
.s-image {
  position: relative;
  width: 100%;
  height: 100%;
  img {
    width: 100%;
    height: 100%;
    overflow: hidden;
    transition: all 0.3s;
  }
  .loading {
    position: absolute;
    // top: 0;
    // left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
  }
  .cover {
    // position: absolute;
    // top: 0;
    // left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    opacity: 0;
    &.loaded {
      opacity: 1;
    }
  }
}
</style>

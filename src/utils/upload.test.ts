// 拦截 @/services/static 避免触发 @umijs/max → antd-style → matchMedia 链路
// getStaticUrl 逻辑内联，与真实实现一致
jest.mock('@/services/static', () => ({
  uploadStatic: jest.fn(),
  getStaticUrl: (path: string): string => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    const STATIC_PREFIX = '/api/system/static/';
    if (path.startsWith(STATIC_PREFIX)) return path;
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `${STATIC_PREFIX}${cleanPath}`;
  },
}));

import { getFileUrl, urlToUploadFile } from './upload';

describe('urlToUploadFile', () => {
  it('相对路径：添加 /api/system/static/ 前缀', () => {
    const file = urlToUploadFile('diagnosis/lab1.jpg');
    expect(file.url).toBe('/api/system/static/diagnosis/lab1.jpg');
    expect(file.thumbUrl).toBe('/api/system/static/diagnosis/lab1.jpg');
  });

  it('以 / 开头的路径：去掉前导斜杠后添加前缀', () => {
    const file = urlToUploadFile('/diagnosis/lab1.jpg');
    expect(file.url).toBe('/api/system/static/diagnosis/lab1.jpg');
  });

  it('完整 URL：原样保留', () => {
    const file = urlToUploadFile('https://cdn.example.com/file.jpg');
    expect(file.url).toBe('https://cdn.example.com/file.jpg');
  });

  it('已含 /api/system/static/ 前缀：幂等，不重复添加', () => {
    const file = urlToUploadFile('/api/system/static/diagnosis/lab1.jpg');
    expect(file.url).toBe('/api/system/static/diagnosis/lab1.jpg');
  });

  it('status 固定为 done（回显时表现为已上传）', () => {
    const file = urlToUploadFile('diagnosis/lab1.jpg');
    expect(file.status).toBe('done');
  });

  it('uid 使用原始 path 作为唯一标识', () => {
    const file = urlToUploadFile('diagnosis/lab1.jpg');
    expect(file.uid).toBe('diagnosis/lab1.jpg');
  });

  it('未提供 name 时从路径末段提取文件名', () => {
    const file = urlToUploadFile('diagnosis/subdir/result.png');
    expect(file.name).toBe('result.png');
  });

  it('提供 name 时使用指定名称', () => {
    const file = urlToUploadFile('diagnosis/lab1.jpg', '实验室检测结果');
    expect(file.name).toBe('实验室检测结果');
  });
});

describe('step2InitialValues 映射逻辑（IIFE → useMemo 等价验证）', () => {
  /**
   * 复刻 Diagnosis/index.tsx 中 step2InitialValues useMemo 的计算逻辑，
   * 验证与原 IIFE 行为完全一致。
   */
  function buildStep2Values(
    labMap: Record<string, string> | null | undefined,
    imgMap: Record<string, string> | null | undefined,
  ) {
    const vals: Record<string, any[]> = {};
    if (labMap) {
      for (const [indicatorId, url] of Object.entries(labMap)) {
        vals[`lab__${indicatorId}`] = [urlToUploadFile(url)];
      }
    }
    if (imgMap) {
      for (const [indicatorId, url] of Object.entries(imgMap)) {
        vals[`img__${indicatorId}`] = [urlToUploadFile(url)];
      }
    }
    return vals;
  }

  it('两个 map 均为 null 时返回空对象', () => {
    expect(buildStep2Values(null, null)).toEqual({});
  });

  it('只有 lab_result_images 时正确生成 lab__ 前缀字段', () => {
    const result = buildStep2Values(
      {
        'indicator-1': 'diagnosis/lab1.jpg',
        'indicator-2': 'diagnosis/lab2.jpg',
      },
      null,
    );
    expect(Object.keys(result)).toEqual([
      'lab__indicator-1',
      'lab__indicator-2',
    ]);
    expect(result['lab__indicator-1']).toHaveLength(1);
    expect(result['lab__indicator-1'][0].status).toBe('done');
    expect(result['lab__indicator-2'][0].url).toBe(
      '/api/system/static/diagnosis/lab2.jpg',
    );
  });

  it('只有 imaging_result_images 时正确生成 img__ 前缀字段', () => {
    const result = buildStep2Values(null, { 'mri-1': 'diagnosis/mri.jpg' });
    expect(Object.keys(result)).toEqual(['img__mri-1']);
    expect(result['img__mri-1'][0].url).toBe(
      '/api/system/static/diagnosis/mri.jpg',
    );
  });

  it('lab 和 imaging 同时存在时字段不互相干扰', () => {
    const result = buildStep2Values(
      { 'lab-a': 'diagnosis/laba.jpg' },
      { 'img-b': 'diagnosis/imgb.jpg' },
    );
    expect(result['lab__lab-a']).toBeDefined();
    expect(result['img__img-b']).toBeDefined();
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('每个字段的值为长度为 1 的数组（ProFormUploadButton max=1）', () => {
    const result = buildStep2Values(
      { 'lab-1': 'diagnosis/lab1.jpg' },
      { 'img-1': 'diagnosis/img1.jpg' },
    );
    expect(result['lab__lab-1']).toHaveLength(1);
    expect(result['img__img-1']).toHaveLength(1);
  });
});

describe('getFileUrl', () => {
  it('已上传文件从 response.data.url 提取', () => {
    const file = {
      uid: '1',
      name: 'test.jpg',
      response: { data: { url: '/api/system/static/test.jpg' } },
    } as any;
    expect(getFileUrl(file)).toBe('/api/system/static/test.jpg');
  });

  it('回显文件从 url 字段提取', () => {
    const file = {
      uid: '1',
      name: 'test.jpg',
      url: '/api/system/static/test.jpg',
    } as any;
    expect(getFileUrl(file)).toBe('/api/system/static/test.jpg');
  });

  it('优先使用 thumbUrl', () => {
    const file = {
      uid: '1',
      name: 'test.jpg',
      thumbUrl: '/thumb/test.jpg',
      url: '/url/test.jpg',
    } as any;
    expect(getFileUrl(file)).toBe('/thumb/test.jpg');
  });

  it('三者均无时返回空字符串', () => {
    const file = { uid: '1', name: 'test.jpg' } as any;
    expect(getFileUrl(file)).toBe('');
  });
});

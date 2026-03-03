// 拦截所有会触发 @umijs/max → antd-style → matchMedia 链路的服务依赖
// computeCurrentStep 是纯函数，不需要真实的服务实现
jest.mock('@/services/diagnosis', () => ({
  createDiagnosis: jest.fn(),
  getCurrentDiagnosis: jest.fn(),
  updateDiagnosis: jest.fn(),
}));
jest.mock('@/services/diagnostic-scale', () => ({
  getDiagnosticScales: jest.fn(),
}));
jest.mock('@/services/disease-type', () => ({ getDiseaseTypes: jest.fn() }));
jest.mock('@/services/imaging-indicator', () => ({
  getImagingIndicators: jest.fn(),
}));
jest.mock('@/services/lab-indicator', () => ({
  getLabIndicators: jest.fn(),
  getLabIndicatorMeta: jest.fn(),
}));
jest.mock('@/services/llm', () => ({
  getDiseaseJudgement: jest.fn(),
  getPrescriptionRecommendation: jest.fn(),
  getScreeningRecommendation: jest.fn(),
}));
jest.mock('@/services/medicine', () => ({ getMedicines: jest.fn() }));
jest.mock('@/services/patient-user', () => ({ getPatient: jest.fn() }));
jest.mock('@/services/rehab-level', () => ({ getRehabLevels: jest.fn() }));
jest.mock('@/utils/prescriptionMapping', () => ({
  mapCognitiveFromIds: jest.fn(),
  mapExercisesFromPlan: jest.fn(),
  mapMedicationsFromIds: jest.fn(),
}));

import { computeCurrentStep } from './useDiagnosisFlow';

/** 创建最小有效的 DiagnosisDetailResponse，可按需覆盖字段 */
function makeData(overrides: Record<string, any> = {}): any {
  return {
    diagnosis_id: 'diag-1',
    patient_id: 'patient-1',
    doctor_id: 'doctor-1',
    diagnosis_status: null,
    created_at: null,
    completed_at: null,
    chief_complaint: null,
    physical_signs: null,
    present_illness: null,
    screening_items: null,
    examination_steps: null,
    lab_result_images: null,
    blood_routine_url: null,
    imaging_result_images: null,
    diagnosis_results: [],
    diagnosis_note: null,
    medicine_ids: [],
    rehab_level_ids: [],
    exercise_plan: [],
    diet_plan: null,
    prescription_summary: null,
    unfinished_scale_ids: [],
    ...overrides,
  };
}

describe('computeCurrentStep', () => {
  // -------- 基础分支 --------

  it('返回 0：data 为 null', () => {
    expect(computeCurrentStep(null)).toBe(0);
  });

  it('返回 -1：诊断已完成', () => {
    expect(computeCurrentStep(makeData({ diagnosis_status: '已完成' }))).toBe(
      -1,
    );
  });

  it('返回 0：缺少主诉', () => {
    expect(computeCurrentStep(makeData({ chief_complaint: null }))).toBe(0);
  });

  it('返回 1：有主诉但未选筛查项', () => {
    expect(computeCurrentStep(makeData({ chief_complaint: '头痛' }))).toBe(1);
  });

  it('返回 1：screening_items 全为空数组', () => {
    expect(
      computeCurrentStep(
        makeData({
          chief_complaint: '头痛',
          screening_items: {
            selected_assessments: [],
            selected_lab_tests: [],
            selected_imaging_tests: [],
          },
        }),
      ),
    ).toBe(1);
  });

  // -------- Step 2：检测结果录入 --------

  describe('Step 2 停留条件', () => {
    it('仅选了量表（无实验室/影像），停在 Step 2', () => {
      // hasExpected = false → 条件不满足 → 返回 2
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: ['scale-1'],
              selected_lab_tests: [],
              selected_imaging_tests: [],
            },
          }),
        ),
      ).toBe(2);
    });

    it('选了实验室但一张未上传，停在 Step 2', () => {
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: [],
              selected_lab_tests: ['lab-1', 'lab-2'],
              selected_imaging_tests: [],
            },
            // lab-2 缺失
            lab_result_images: { 'lab-1': 'diagnosis/lab1.jpg' },
          }),
        ),
      ).toBe(2);
    });

    it('选了实验室但 lab_result_images 为 null，停在 Step 2', () => {
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: [],
              selected_lab_tests: ['lab-1'],
              selected_imaging_tests: [],
            },
            lab_result_images: null,
          }),
        ),
      ).toBe(2);
    });

    it('选了影像但未上传，停在 Step 2', () => {
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: [],
              selected_lab_tests: [],
              selected_imaging_tests: ['img-1'],
            },
            imaging_result_images: null,
          }),
        ),
      ).toBe(2);
    });
  });

  describe('Step 2 → Step 3 推进条件（所有必传项均已上传）', () => {
    it('实验室全部上传完成，推进到 Step 3', () => {
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: [],
              selected_lab_tests: ['lab-1', 'lab-2'],
              selected_imaging_tests: [],
            },
            lab_result_images: {
              'lab-1': 'diagnosis/lab1.jpg',
              'lab-2': 'diagnosis/lab2.jpg',
            },
          }),
        ),
      ).toBe(3);
    });

    it('影像全部上传完成，推进到 Step 3', () => {
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: [],
              selected_lab_tests: [],
              selected_imaging_tests: ['img-1'],
            },
            imaging_result_images: { 'img-1': 'diagnosis/mri.jpg' },
          }),
        ),
      ).toBe(3);
    });

    it('实验室 + 影像 + 量表全部满足，推进到 Step 3', () => {
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: ['scale-1'],
              selected_lab_tests: ['lab-1'],
              selected_imaging_tests: ['img-1'],
            },
            lab_result_images: { 'lab-1': 'diagnosis/lab1.jpg' },
            imaging_result_images: { 'img-1': 'diagnosis/mri.jpg' },
          }),
        ),
      ).toBe(3);
    });

    it('影像已传但实验室未传完，仍停在 Step 2', () => {
      expect(
        computeCurrentStep(
          makeData({
            chief_complaint: '头痛',
            screening_items: {
              selected_assessments: [],
              selected_lab_tests: ['lab-1', 'lab-2'],
              selected_imaging_tests: ['img-1'],
            },
            lab_result_images: { 'lab-1': 'diagnosis/lab1.jpg' }, // lab-2 缺失
            imaging_result_images: { 'img-1': 'diagnosis/mri.jpg' },
          }),
        ),
      ).toBe(2);
    });
  });

  // -------- Step 4 --------

  it('返回 4：已有诊断结果', () => {
    expect(
      computeCurrentStep(
        makeData({
          chief_complaint: '头痛',
          screening_items: {
            selected_assessments: ['scale-1'],
            selected_lab_tests: [],
            selected_imaging_tests: [],
          },
          diagnosis_results: ['disease-alzheimer'],
        }),
      ),
    ).toBe(4);
  });
});

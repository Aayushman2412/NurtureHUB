import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AuthLayout from '../components/auth/AuthLayout';

const RegistrationPage: React.FC = () => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Form Fields State
  const [age, setAge] = useState<number | ''>('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState('');
  const [phone, setPhone] = useState('');
  const [department] = useState('Women & Child Development (WCD)');
  const [role, setRole] = useState('Anganwadi Worker');
  const [workCenterType, setWorkCenterType] = useState('Anganwadi Center (AWC)');
  const [workCenterName, setWorkCenterName] = useState('');
  const [district, setDistrict] = useState('');

  const { updateProfile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const nextStep = () => {
    // Basic validation for Step 1
    if (step === 1) {
      if (!dob || !sex || !phone) {
        showToast('Please fill in all personal details', 'warning');
        return;
      }
    }
    // Basic validation for Step 2
    if (step === 2) {
      if (!workCenterName || !district) {
        showToast('Please fill in all professional details', 'warning');
        return;
      }
    }
    setStep(prev => prev + 1);
  };

  const prevStep = () => {
    setStep(prev => prev - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    showToast('Submitting profile details...', 'info');

    try {
      await updateProfile({
        age: age ? Number(age) : undefined,
        date_of_birth: dob ? dob : undefined,
        sex: sex || undefined,
        phone: phone || undefined,
        department: department || undefined,
        role: role || undefined,
        work_center_type: workCenterType || undefined,
        work_center_name: workCenterName || undefined,
        district: district || undefined
      });
      showToast('Registration completed successfully! Welcome to NurtureHUB.', 'success');
      navigate('/dashboard');
    } catch (err: any) {
      showToast('Failed to save profile registration. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Complete Registration"
      subtitle="Just a few details to customize your learning and assessment dashboard."
    >
      {/* Stepper progress indicator */}
      <div 
        id="reg-stepper" 
        className="stepper" 
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          marginBottom: '32px',
          position: 'relative'
        }}
      >
        {/* Stepper bar connector */}
        <div style={{
          position: 'absolute',
          top: '15px',
          left: '10%',
          right: '10%',
          height: '2px',
          backgroundColor: 'var(--border-color)',
          zIndex: 1
        }} />
        <div style={{
          position: 'absolute',
          top: '15px',
          left: '10%',
          width: step === 1 ? '0%' : step === 2 ? '40%' : '80%',
          height: '2px',
          backgroundColor: 'var(--primary-500)',
          transition: 'width var(--transition-base)',
          zIndex: 2
        }} />

        <div className={`stepper-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`} style={{ zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="step-circle" style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: step > 1 ? 'var(--primary-500)' : step === 1 ? 'var(--primary-100)' : 'var(--bg-secondary)', border: `2px solid ${step >= 1 ? 'var(--primary-500)' : 'var(--border-color)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: step > 1 ? 'white' : 'var(--primary-700)' }}>1</div>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: '8px', color: step >= 1 ? 'var(--text-primary)' : 'var(--text-muted)' }}>Personal</span>
        </div>

        <div className={`stepper-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`} style={{ zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="step-circle" style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: step > 2 ? 'var(--primary-500)' : step === 2 ? 'var(--primary-100)' : 'var(--bg-secondary)', border: `2px solid ${step >= 2 ? 'var(--primary-500)' : 'var(--border-color)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: step > 2 ? 'white' : step === 2 ? 'var(--primary-700)' : 'var(--text-muted)' }}>2</div>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: '8px', color: step >= 2 ? 'var(--text-primary)' : 'var(--text-muted)' }}>Professional</span>
        </div>

        <div className={`stepper-step ${step === 3 ? 'active' : ''}`} style={{ zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="step-circle" style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: step === 3 ? 'var(--primary-100)' : 'var(--bg-secondary)', border: `2px solid ${step === 3 ? 'var(--primary-500)' : 'var(--border-color)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: step === 3 ? 'var(--primary-700)' : 'var(--text-muted)' }}>3</div>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: '8px', color: step === 3 ? 'var(--text-primary)' : 'var(--text-muted)' }}>Review</span>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Step 1: Personal Details */}
        {step === 1 && (
          <div className="reg-step active" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="dob-input">Date of Birth</label>
                <input
                  id="dob-input"
                  type="date"
                  className="form-control"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="age-input">Age (Years)</label>
                <input
                  id="age-input"
                  type="number"
                  className="form-control"
                  placeholder="e.g. 28"
                  value={age}
                  onChange={(e) => setAge(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Sex</label>
              <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                {['Female', 'Male', 'Other'].map(option => (
                  <label key={option} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="sex"
                      value={option}
                      checked={sex === option}
                      onChange={(e) => setSex(e.target.value)}
                      required
                      style={{ accentColor: 'var(--primary-500)' }}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="phone-input">Contact Number</label>
              <input
                id="phone-input"
                type="tel"
                className="form-control"
                placeholder="e.g. +91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        {/* Step 2: Professional Details */}
        {step === 2 && (
          <div className="reg-step active" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="role-select">Designation / Role</label>
              <select
                id="role-select"
                className="form-control"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="Anganwadi Worker">Anganwadi Worker (AWW)</option>
                <option value="Anganwadi Helper">Anganwadi Helper (AWH)</option>
                <option value="Anganwadi Supervisor">Anganwadi Supervisor</option>
                <option value="Child Development Project Officer">Child Development Project Officer (CDPO)</option>
                <option value="ANM / Health Worker">ANM / Health Worker</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="center-select">Work Center Type</label>
              <select
                id="center-select"
                className="form-control"
                value={workCenterType}
                onChange={(e) => setWorkCenterType(e.target.value)}
              >
                <option value="Anganwadi Center (AWC)">Anganwadi Center (AWC)</option>
                <option value="Mini Anganwadi Center">Mini Anganwadi Center</option>
                <option value="Sector Office">Sector Office</option>
                <option value="Project Office (CDPO)">Project Office (CDPO)</option>
                <option value="Primary Health Center (PHC)">Primary Health Center (PHC)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="centername-input">Center / Office Name</label>
              <input
                id="centername-input"
                type="text"
                className="form-control"
                placeholder="e.g. Sector-4 AWC / Kalyanpur PHC"
                value={workCenterName}
                onChange={(e) => setWorkCenterName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="district-input">District</label>
              <input
                id="district-input"
                type="text"
                className="form-control"
                placeholder="e.g. Gorakhpur / Lucknow"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        {/* Step 3: Review & Submit */}
        {step === 3 && (
          <div className="reg-step active" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div 
              style={{ 
                backgroundColor: 'var(--bg-primary)', 
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '20px',
                fontSize: '0.875rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px'
              }}
            >
              <h4 style={{ fontWeight: 700, borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', margin: 0, color: 'var(--text-primary)' }}>
                Review Registration Details
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Date of Birth:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{dob}</span>

                <span style={{ color: 'var(--text-muted)' }}>Sex:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{sex}</span>

                <span style={{ color: 'var(--text-muted)' }}>Phone Number:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{phone}</span>

                <span style={{ color: 'var(--text-muted)' }}>Designation:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{role}</span>

                <span style={{ color: 'var(--text-muted)' }}>Center Type:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{workCenterType}</span>

                <span style={{ color: 'var(--text-muted)' }}>Center Name:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{workCenterName}</span>

                <span style={{ color: 'var(--text-muted)' }}>District:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{district}</span>
              </div>
            </div>
            
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              By completing this registration, your account will be unlocked for training modules, assessments, and tracking metrics.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '16px', marginTop: '32px' }}>
          {step > 1 && (
            <button
              type="button"
              onClick={prevStep}
              className="btn btn-outline"
              disabled={loading}
              style={{ flex: 1, padding: '12px', cursor: 'pointer' }}
            >
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={nextStep}
              className="btn btn-primary"
              style={{ flex: 2, padding: '12px', cursor: 'pointer' }}
            >
              Continue →
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ flex: 2, padding: '12px', fontWeight: 600, cursor: 'pointer' }}
            >
              {loading ? 'Submitting...' : 'Complete Registration ✓'}
            </button>
          )}
        </div>
      </form>
    </AuthLayout>
  );
};

export default RegistrationPage;

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Phone, Briefcase, MapPin, Calendar, Heart } from 'lucide-react';

const ProfilePage: React.FC = () => {
  const { user, updateProfile } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'personal' | 'professional'>('personal');
  const [loading, setLoading] = useState(false);

  // Form states
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [age, setAge] = useState<number | ''>(user?.age || '');
  const [dob, setDob] = useState(user?.date_of_birth || '');
  const [sex, setSex] = useState(user?.sex || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [department, setDepartment] = useState(user?.department || 'Women & Child Development (WCD)');
  const [role, setRole] = useState(user?.role || 'Anganwadi Worker');
  const [workCenterType, setWorkCenterType] = useState(user?.work_center_type || 'Anganwadi Center (AWC)');
  const [workCenterName, setWorkCenterName] = useState(user?.work_center_name || '');
  const [district, setDistrict] = useState(user?.district || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    showToast('Saving profile updates...', 'info');

    try {
      await updateProfile({
        full_name: fullName,
        age: age ? Number(age) : null,
        date_of_birth: dob ? dob : null,
        sex: sex || null,
        phone: phone || null,
        department,
        role,
        work_center_type: workCenterType,
        work_center_name: workCenterName,
        district
      });
      showToast('Profile updated successfully!', 'success');
    } catch (err: any) {
      showToast('Failed to update profile details', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* Profile Header Card */}
      <div 
        className="card" 
        style={{ 
          padding: '32px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '24px', 
          flexWrap: 'wrap',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)' 
        }}
      >
        <div 
          className="avatar avatar-lg font-display" 
          style={{ 
            width: '80px', 
            height: '80px', 
            fontSize: '2rem', 
            boxShadow: '0 0 0 4px var(--primary-100)',
            backgroundColor: 'var(--primary-500)',
            color: 'white'
          }}
        >
          {user?.avatar_initials || 'U'}
        </div>

        <div style={{ flex: 1 }}>
          <h2 className="font-display" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
            {user?.full_name || 'Healthcare Professional'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 12px 0' }}>
            {user?.role || 'ICDS Worker'} • {user?.work_center_name || 'AWC Center'}
          </p>
          <div style={{ display: 'flex', gap: '24px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            <span>Email: <strong>{user?.email}</strong></span>
            <span>Joined: <strong>{user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</strong></span>
          </div>
        </div>
      </div>

      {/* Main Settings Tabs and Forms */}
      <div className="card" style={{ padding: 0 }}>
        {/* Navigation Tabs */}
        <div 
          style={{ 
            display: 'flex', 
            borderBottom: '1px solid var(--border-color)', 
            padding: '0 20px',
            backgroundColor: 'var(--bg-primary)',
            borderTopLeftRadius: 'var(--radius-lg)',
            borderTopRightRadius: 'var(--radius-lg)' 
          }}
        >
          <button
            onClick={() => setActiveTab('personal')}
            className={`tab-item ${activeTab === 'personal' ? 'active' : ''}`}
            style={{
              padding: '16px 20px',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              background: 'none',
              color: activeTab === 'personal' ? 'var(--primary-600)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'personal' ? '2px solid var(--primary-500)' : '2px solid transparent',
              cursor: 'pointer'
            }}
          >
            Personal Details
          </button>
          <button
            onClick={() => setActiveTab('professional')}
            className={`tab-item ${activeTab === 'professional' ? 'active' : ''}`}
            style={{
              padding: '16px 20px',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              background: 'none',
              color: activeTab === 'professional' ? 'var(--primary-600)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'professional' ? '2px solid var(--primary-500)' : '2px solid transparent',
              cursor: 'pointer'
            }}
          >
            Professional Info
          </button>
        </div>

        {/* Forms Content */}
        <form onSubmit={handleSubmit} style={{ padding: '32px' }}>
          {activeTab === 'personal' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="fullname-input">Full Name</label>
                <div style={{ position: 'relative' }}>
                  <User size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="fullname-input"
                    type="text"
                    className="form-control"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    style={{ paddingLeft: '44px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="dob-input">Date of Birth</label>
                  <div style={{ position: 'relative' }}>
                    <Calendar size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="dob-input"
                      type="date"
                      className="form-control"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      required
                      style={{ paddingLeft: '44px' }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="age-input">Age</label>
                  <input
                    id="age-input"
                    type="number"
                    className="form-control"
                    value={age}
                    onChange={(e) => setAge(e.target.value ? Number(e.target.value) : '')}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Sex</label>
                <div style={{ display: 'flex', gap: '20px', marginTop: '4px' }}>
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
                <label className="form-label" htmlFor="phone-input">Contact Phone</label>
                <div style={{ position: 'relative' }}>
                  <Phone size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="phone-input"
                    type="tel"
                    className="form-control"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    style={{ paddingLeft: '44px' }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="dept-select">Department</label>
                <div style={{ position: 'relative' }}>
                  <Briefcase size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <select
                    id="dept-select"
                    className="form-control"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    style={{ paddingLeft: '44px' }}
                  >
                    <option value="Women & Child Development (WCD)">Women & Child Development (WCD)</option>
                    <option value="Department of Health and Family Welfare">Department of Health & Family Welfare</option>
                    <option value="National Health Mission (NHM)">National Health Mission (NHM)</option>
                  </select>
                </div>
              </div>

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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
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
                  <label className="form-label" htmlFor="district-input">District Location</label>
                  <div style={{ position: 'relative' }}>
                    <MapPin size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="district-input"
                      type="text"
                      className="form-control"
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      required
                      style={{ paddingLeft: '44px' }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="centername-input">Center / Office Name</label>
                <div style={{ position: 'relative' }}>
                  <Heart size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="centername-input"
                    type="text"
                    className="form-control"
                    value={workCenterName}
                    onChange={(e) => setWorkCenterName(e.target.value)}
                    required
                    style={{ paddingLeft: '44px' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action Row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', marginTop: '32px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ padding: '12px 30px', fontWeight: 600, cursor: 'pointer' }}
            >
              {loading ? 'Saving...' : 'Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
};

export default ProfilePage;
